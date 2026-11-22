//! Atlas Commerce — Targeted Rust + WebAssembly Finance Core (ABI v2).
//!
//! Zero external crate dependencies so `cargo test` and
//! `cargo build --target wasm32-unknown-unknown --release` work hermetically.
//!
//! Linear-memory ownership rules for buffer exports:
//! - Callers allocate input/output buffers via `fc_alloc(byte_len)` and release them
//!   with `fc_dealloc(ptr, byte_len)`.
//! - Every ABI function validates non-null pointers, maximum byte/element bounds,
//!   and alignment before constructing slices, returning explicit `i32` status codes
//!   (`0` = OK, negative = error) with zero panics across the ABI boundary.

pub mod finance;
pub mod invoice;
pub mod round;
pub mod validate;

use core::slice;
use finance::{classify_doc, compute_payroll_obligation, days_from_civil, is_valid_ymd, Ymd};
use invoice::{aggregate_document_totals, apply_bulk_discount, compute_invoice_line, compute_refund_split, BulkTier, LineInput, LineOutput};
use round::{round2, round6, round_dh, round_with_mode, sub_money, RoundingMode};
use validate::{is_valid_credit_prefix, is_valid_next_credit_number, is_valid_period_str};

pub const ABI_VERSION: u32 = 2;
pub const MAX_ALLOC_BYTES: usize = 1024 * 1024; // 1 MiB hard cap per allocation
pub const MAX_BATCH_LINES: usize = 4096;

pub const ERR_OK: i32 = 0;
pub const ERR_NULL_PTR: i32 = -1;
pub const ERR_BOUNDS: i32 = -2;
pub const ERR_INVALID_INPUT: i32 = -3;
pub const ERR_INVALID_DATE: i32 = -4;
pub const ERR_ALIGNMENT: i32 = -5;

/* ─────────────────────────── Safe Linear-Memory Allocator ─────────────────────────── */

#[no_mangle]
pub extern "C" fn fc_alloc(byte_len: usize) -> *mut u8 {
    if byte_len == 0 || byte_len > MAX_ALLOC_BYTES {
        return core::ptr::null_mut();
    }
    // Allocate as u64-aligned vector to guarantee 8-byte alignment for f64 slices.
    let u64_len = (byte_len + 7) / 8;
    let mut vec: Vec<u64> = Vec::with_capacity(u64_len);
    let ptr = vec.as_mut_ptr() as *mut u8;
    core::mem::forget(vec);
    ptr
}

#[no_mangle]
pub extern "C" fn fc_dealloc(ptr: *mut u8, byte_len: usize) {
    if ptr.is_null() || byte_len == 0 || byte_len > MAX_ALLOC_BYTES {
        return;
    }
    if (ptr as usize) % core::mem::align_of::<u64>() != 0 {
        return;
    }
    let u64_len = (byte_len + 7) / 8;
    unsafe {
        let _ = Vec::from_raw_parts(ptr as *mut u64, 0, u64_len);
    }
}

fn slices_overlap(a: usize, a_bytes: usize, b: usize, b_bytes: usize) -> bool {
    if a_bytes == 0 || b_bytes == 0 {
        return false;
    }
    let a_end = match a.checked_add(a_bytes) {
        Some(v) => v,
        None => return true,
    };
    let b_end = match b.checked_add(b_bytes) {
        Some(v) => v,
        None => return true,
    };
    a < b_end && b < a_end
}

fn read_bytes<'a>(ptr: *const u8, len: usize, max_len: usize) -> Result<&'a [u8], i32> {
    if ptr.is_null() {
        return Err(ERR_NULL_PTR);
    }
    if len > max_len {
        return Err(ERR_BOUNDS);
    }
    if len == 0 {
        return Ok(&[]);
    }
    if (ptr as usize).checked_add(len).is_none() {
        return Err(ERR_BOUNDS);
    }
    Ok(unsafe { slice::from_raw_parts(ptr, len) })
}

fn read_f64_slice<'a>(ptr: *const f64, len: usize, max_len: usize) -> Result<&'a [f64], i32> {
    if ptr.is_null() {
        return Err(ERR_NULL_PTR);
    }
    if len > max_len {
        return Err(ERR_BOUNDS);
    }
    if (ptr as usize) % core::mem::align_of::<f64>() != 0 {
        return Err(ERR_ALIGNMENT);
    }
    if len == 0 {
        return Ok(&[]);
    }
    let byte_len = len.checked_mul(8).ok_or(ERR_BOUNDS)?;
    if (ptr as usize).checked_add(byte_len).is_none() {
        return Err(ERR_BOUNDS);
    }
    Ok(unsafe { slice::from_raw_parts(ptr, len) })
}

fn write_f64_slice<'a>(ptr: *mut f64, len: usize, max_len: usize) -> Result<&'a mut [f64], i32> {
    if ptr.is_null() {
        return Err(ERR_NULL_PTR);
    }
    if len > max_len {
        return Err(ERR_BOUNDS);
    }
    if (ptr as usize) % core::mem::align_of::<f64>() != 0 {
        return Err(ERR_ALIGNMENT);
    }
    if len == 0 {
        return Ok(&mut []);
    }
    let byte_len = len.checked_mul(8).ok_or(ERR_BOUNDS)?;
    if (ptr as usize).checked_add(byte_len).is_none() {
        return Err(ERR_BOUNDS);
    }
    Ok(unsafe { slice::from_raw_parts_mut(ptr, len) })
}

/* ─────────────────────────── WASM C-ABI v2 Exports ─────────────────────────── */

#[no_mangle]
pub extern "C" fn fc_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn fc_round2(v: f64) -> f64 {
    round2(v)
}

#[no_mangle]
pub extern "C" fn fc_round_dh(v: f64) -> f64 {
    round_dh(v)
}

#[no_mangle]
pub extern "C" fn fc_round6(v: f64) -> f64 {
    round6(v)
}

#[no_mangle]
pub extern "C" fn fc_round_with_mode(v: f64, decimals: u32, mode: u32) -> f64 {
    round_with_mode(v, decimals, RoundingMode::from_u8(mode as u8))
}

#[no_mangle]
pub extern "C" fn fc_is_valid_ymd(y: i32, m: u32, d: u32) -> i32 {
    if is_valid_ymd(y, m, d) { 1 } else { 0 }
}

/// Classify a document into packed state code:
/// 0 = paid, 1 = partial, 2 = unpaid, 3 = overdue, <0 = error (invalid date).
#[no_mangle]
pub extern "C" fn fc_classify_doc_state(
    total: f64,
    paid: f64,
    has_due: i32,
    due_y: i32,
    due_m: u32,
    due_d: u32,
    today_y: i32,
    today_m: u32,
    today_d: u32,
) -> i32 {
    if !is_valid_ymd(today_y, today_m, today_d) {
        return ERR_INVALID_DATE;
    }
    let due = if has_due != 0 {
        if !is_valid_ymd(due_y, due_m, due_d) {
            return ERR_INVALID_DATE;
        }
        Some(Ymd { year: due_y, month: due_m as u8, day: due_d as u8 })
    } else {
        None
    };
    let today = Ymd { year: today_y, month: today_m as u8, day: today_d as u8 };
    classify_doc(total, paid, due, today).state as i32
}

#[no_mangle]
pub extern "C" fn fc_classify_doc_remaining(total: f64, paid: f64) -> f64 {
    let t = round2(total);
    let p = round2(paid);
    let rem = sub_money(t, p, 2).max(0.0);
    if rem <= 0.005 { 0.0 } else { rem }
}

#[no_mangle]
pub extern "C" fn fc_days_between(
    y1: i32, m1: u32, d1: u32,
    y2: i32, m2: u32, d2: u32,
) -> i32 {
    if !is_valid_ymd(y1, m1, d1) || !is_valid_ymd(y2, m2, d2) {
        return i32::MIN;
    }
    let diff = days_from_civil(y2, m2 as u8, d2 as u8) - days_from_civil(y1, m1 as u8, d1 as u8);
    if diff < (i32::MIN as i64 + 1) || diff > (i32::MAX as i64) {
        return i32::MIN;
    }
    diff as i32
}

/// Computes payroll obligation and writes `[amount_due, daily_rate]` into `out_ptr` (len >= 2).
/// Returns 0 on success, or negative error code (`ERR_NULL_PTR`, `ERR_INVALID_INPUT`, `ERR_INVALID_DATE`, etc.).
#[no_mangle]
pub extern "C" fn fc_compute_payroll(
    active: i32,
    pay_amount: f64,
    cycle_days: i32,
    anchor_y: i32, anchor_m: u32, anchor_d: u32,
    asof_y: i32, asof_m: u32, asof_d: u32,
    advances: f64,
    out_ptr: *mut f64,
) -> i32 {
    let out = match write_f64_slice(out_ptr, 2, 2) {
        Ok(s) => s,
        Err(e) => return e,
    };
    if !is_valid_ymd(anchor_y, anchor_m, anchor_d) || !is_valid_ymd(asof_y, asof_m, asof_d) {
        return ERR_INVALID_DATE;
    }
    let anchor = Ymd { year: anchor_y, month: anchor_m as u8, day: anchor_d as u8 };
    let asof = Ymd { year: asof_y, month: asof_m as u8, day: asof_d as u8 };
    match compute_payroll_obligation(active != 0, pay_amount, cycle_days, anchor, asof, advances) {
        Ok(ob) => {
            out[0] = ob.amount_due;
            out[1] = ob.daily_rate;
            ERR_OK
        }
        Err(err) => -(err as i32) - 10,
    }
}

/// Computes WR refund split and writes `[credit_vs_debt, cash_refund, next_paid, status_code]` into `out_ptr` (len >= 4).
#[no_mangle]
pub extern "C" fn fc_compute_refund_split(
    refund_total: f64,
    source_total: f64,
    source_paid: f64,
    source_is_paid: i32,
    invoice_decimals: u32,
    out_ptr: *mut f64,
) -> i32 {
    let out = match write_f64_slice(out_ptr, 4, 4) {
        Ok(s) => s,
        Err(e) => return e,
    };
    match compute_refund_split(refund_total, source_total, source_paid, source_is_paid != 0, invoice_decimals) {
        Ok(split) => {
            out[0] = split.credit_vs_debt;
            out[1] = split.cash_refund;
            out[2] = split.next_paid;
            out[3] = split.status_code as f64;
            ERR_OK
        }
        Err(err) => -(err as i32) - 20,
    }
}

/// Batch invoice calculation over `count` lines.
/// Each line in `in_ptr` occupies 6 f64s:
///   `[quantity, unit_price, list_price, tax_rate, has_explicit_tax_rate (0/1), prices_ttc (0/1)]`
/// Each line output in `out_ptr` occupies 11 f64s, followed by 3 f64s for document totals:
///   line i: `[unit_ht, list_ht, stored_unit_price, stored_list_price, tax_rate, line_ht, line_tax_real, line_ttc, line_total, discount_amount, discount_percent]`
///   tail:   `[subtotal, tax_amount, total]`
#[no_mangle]
pub extern "C" fn fc_compute_invoice_batch(
    in_ptr: *const f64,
    line_count: usize,
    out_ptr: *mut f64,
    default_tax: f64,
    is_quick_sale: i32,
    tax_exempt: i32,
    explicit_inclusive: i32,
    invoice_decimals: u32,
) -> i32 {
    if line_count > MAX_BATCH_LINES {
        return ERR_BOUNDS;
    }
    let in_len = match line_count.checked_mul(6) {
        Some(n) => n,
        None => return ERR_BOUNDS,
    };
    let out_len = match line_count.checked_mul(11).and_then(|n| n.checked_add(3)) {
        Some(n) => n,
        None => return ERR_BOUNDS,
    };
    if slices_overlap(in_ptr as usize, in_len * 8, out_ptr as usize, out_len * 8) {
        return ERR_BOUNDS;
    }
    let inputs = match read_f64_slice(in_ptr, in_len, MAX_BATCH_LINES * 6) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let outputs = match write_f64_slice(out_ptr, out_len, MAX_BATCH_LINES * 11 + 3) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let mut line_results: Vec<LineOutput> = Vec::with_capacity(line_count);
    for i in 0..line_count {
        let base = i * 6;
        let out = compute_invoice_line(LineInput {
            quantity: inputs[base],
            unit_price: inputs[base + 1],
            list_price: inputs[base + 2],
            tax_rate: inputs[base + 3],
            has_explicit_tax_rate: inputs[base + 4] != 0.0,
            default_tax,
            prices_ttc: inputs[base + 5] != 0.0,
            is_quick_sale: is_quick_sale != 0,
            tax_exempt: tax_exempt != 0,
            explicit_inclusive: explicit_inclusive != 0,
            invoice_decimals,
        });
        let ob = i * 11;
        outputs[ob] = out.unit_ht;
        outputs[ob + 1] = out.list_ht;
        outputs[ob + 2] = out.stored_unit_price;
        outputs[ob + 3] = out.stored_list_price;
        outputs[ob + 4] = out.tax_rate;
        outputs[ob + 5] = out.line_ht;
        outputs[ob + 6] = out.line_tax_real;
        outputs[ob + 7] = out.line_ttc;
        outputs[ob + 8] = out.line_total;
        outputs[ob + 9] = out.discount_amount;
        outputs[ob + 10] = out.discount_percent;
        line_results.push(out);
    }

    let totals = aggregate_document_totals(&line_results, invoice_decimals);
    let tail = line_count * 11;
    outputs[tail] = totals.subtotal;
    outputs[tail + 1] = totals.tax_amount;
    outputs[tail + 2] = totals.total;
    ERR_OK
}

/// Bulk discount calculation. `tiers_ptr` holds `tier_count * 2` f64s (`[min_qty, percent, ...]`).
/// Writes `[unit_price, bulk_percent]` into `out_ptr` (len >= 2).
#[no_mangle]
pub extern "C" fn fc_apply_bulk_discount(
    list_price: f64,
    qty: f64,
    tiers_ptr: *const f64,
    tier_count: usize,
    out_ptr: *mut f64,
) -> i32 {
    if tier_count > 256 {
        return ERR_BOUNDS;
    }
    if tier_count > 0 && slices_overlap(tiers_ptr as usize, tier_count * 16, out_ptr as usize, 16) {
        return ERR_BOUNDS;
    }
    let out = match write_f64_slice(out_ptr, 2, 2) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let tiers_raw = if tier_count == 0 {
        &[][..]
    } else {
        match read_f64_slice(tiers_ptr, tier_count * 2, 512) {
            Ok(s) => s,
            Err(e) => return e,
        }
    };
    let mut tiers = Vec::with_capacity(tier_count);
    for i in 0..tier_count {
        tiers.push(BulkTier {
            min_qty: tiers_raw[i * 2],
            percent: tiers_raw[i * 2 + 1],
        });
    }
    let (unit, pct) = apply_bulk_discount(list_price, qty, &tiers);
    out[0] = unit;
    out[1] = pct;
    ERR_OK
}

#[no_mangle]
pub extern "C" fn fc_validate_credit_prefix(ptr: *const u8, len: usize) -> i32 {
    match read_bytes(ptr, len, 64) {
        Ok(b) => if is_valid_credit_prefix(b) { 1 } else { 0 },
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn fc_validate_next_credit_number(n: f64) -> i32 {
    if is_valid_next_credit_number(n) { 1 } else { 0 }
}

#[no_mangle]
pub extern "C" fn fc_validate_period(ptr: *const u8, len: usize) -> i32 {
    match read_bytes(ptr, len, 32) {
        Ok(b) => if is_valid_period_str(b) { 1 } else { 0 },
        Err(e) => e,
    }
}

#[cfg(test)]
mod abi_tests {
    use super::*;

    #[test]
    fn test_abi_version_and_alloc_guards() {
        assert_eq!(fc_abi_version(), 2);
        assert!(fc_alloc(0).is_null());
        assert!(fc_alloc(MAX_ALLOC_BYTES + 1).is_null());
        let ptr = fc_alloc(64);
        assert!(!ptr.is_null());
        assert_eq!((ptr as usize) % 8, 0);
        fc_dealloc(ptr, 64);
        fc_dealloc(core::ptr::null_mut(), 64);
    }

    #[test]
    fn test_abi_batch_and_validation_guards() {
        assert_eq!(fc_validate_credit_prefix(core::ptr::null(), 3), ERR_NULL_PTR);
        assert_eq!(fc_validate_credit_prefix(b"WR-".as_ptr(), 3), 1);
        assert_eq!(fc_validate_credit_prefix(b"-BAD".as_ptr(), 4), 0);
        assert_eq!(fc_validate_period(b"2026-10".as_ptr(), 7), 1);
        assert_eq!(fc_validate_period(b"2026-13".as_ptr(), 7), 0);
        assert_eq!(fc_is_valid_ymd(2026, 2, 31), 0);
        assert_eq!(fc_is_valid_ymd(2024, 2, 29), 1);
        assert_eq!(fc_classify_doc_state(100.0, 0.0, 1, 2026, 2, 31, 2026, 10, 20), ERR_INVALID_DATE);

        let inputs = [2.0_f64, 120.0, 120.0, 20.0, 1.0, 1.0];
        let mut outputs = [0.0_f64; 14];
        let rc = fc_compute_invoice_batch(inputs.as_ptr(), 1, outputs.as_mut_ptr(), 20.0, 0, 0, 1, 0);
        assert_eq!(rc, ERR_OK);
        assert_eq!(outputs[11], 200.0); // subtotal
        assert_eq!(outputs[12], 40.0);  // tax
        assert_eq!(outputs[13], 240.0); // total
    }

    #[test]
    fn test_abi_memory_safety_null_alignment_bounds_overlap() {
        // Null pointers
        assert_eq!(fc_compute_payroll(1, 1000.0, 30, 2026, 1, 1, 2026, 1, 10, 0.0, core::ptr::null_mut()), ERR_NULL_PTR);
        assert_eq!(fc_compute_refund_split(100.0, 100.0, 100.0, 1, 2, core::ptr::null_mut()), ERR_NULL_PTR);
        assert_eq!(fc_compute_invoice_batch(core::ptr::null(), 1, [0.0_f64; 14].as_mut_ptr(), 20.0, 0, 0, 1, 2), ERR_NULL_PTR);

        // Bounds guards
        let mut out = [0.0_f64; 14];
        assert_eq!(fc_compute_invoice_batch([0.0_f64; 6].as_ptr(), MAX_BATCH_LINES + 1, out.as_mut_ptr(), 20.0, 0, 0, 1, 2), ERR_BOUNDS);
        assert_eq!(fc_apply_bulk_discount(100.0, 5.0, core::ptr::null(), 257, out.as_mut_ptr()), ERR_BOUNDS);

        // Alignment guard (1-byte offset from 8-byte-aligned buffer)
        #[repr(align(8))]
        struct Aligned64([u8; 64]);
        let mut raw = Aligned64([0_u8; 64]);
        let unaligned_ptr = unsafe { raw.0.as_mut_ptr().add(1) } as *mut f64;
        assert_eq!(fc_compute_refund_split(50.0, 100.0, 0.0, 0, 2, unaligned_ptr), ERR_ALIGNMENT);

        // Aliasing / overlap guard
        let mut shared = [0.0_f64; 16];
        let overlap_rc = fc_compute_invoice_batch(shared.as_ptr(), 1, shared.as_mut_ptr(), 20.0, 0, 0, 1, 2);
        assert_eq!(overlap_rc, ERR_BOUNDS);

        // Date bounds sentinel
        assert_eq!(fc_days_between(2026, 2, 31, 2026, 3, 1), i32::MIN);

        // Non-finite / negative / out-of-range inputs across ABI exports never panic
        assert!(fc_compute_payroll(1, f64::NAN, 30, 2026, 1, 1, 2026, 1, 10, 0.0, out.as_mut_ptr()) < 0);
        assert!(fc_compute_payroll(1, 1000.0, 0, 2026, 1, 1, 2026, 1, 10, 0.0, out.as_mut_ptr()) < 0);
        assert!(fc_compute_payroll(1, 1000.0, 30, 2026, 1, 1, 2026, 1, 10, -5.0, out.as_mut_ptr()) < 0);
        assert!(fc_compute_refund_split(f64::INFINITY, 100.0, 0.0, 0, 2, out.as_mut_ptr()) < 0);
        assert!(fc_compute_refund_split(150.0, 100.0, 0.0, 0, 2, out.as_mut_ptr()) < 0);
        assert_eq!(fc_validate_credit_prefix(b"WR-".as_ptr(), 65), ERR_BOUNDS);
        assert_eq!(fc_validate_period(b"2026-10".as_ptr(), 33), ERR_BOUNDS);
        assert_eq!(fc_apply_bulk_discount(100.0, 5.0, core::ptr::null(), 0, out.as_mut_ptr()), ERR_OK);
        assert_eq!(out[0], 100.0);
        assert_eq!(out[1], 0.0);

        // Zero-length / invalid dealloc guards never panic
        fc_dealloc(core::ptr::null_mut(), 0);
        fc_dealloc(unaligned_ptr as *mut u8, 64);
        fc_dealloc(shared.as_mut_ptr() as *mut u8, MAX_ALLOC_BYTES + 1);
    }
}
