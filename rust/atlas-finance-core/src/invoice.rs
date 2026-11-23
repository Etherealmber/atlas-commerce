//! Deterministic, currency-aware invoice, quote, quick-sale, bulk-discount, and refund-split arithmetic.

use crate::round::{add_money, round2, round6, round_with_mode, sub_money, RoundingMode};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CurrencySpec {
    pub minor_decimals: u32,
    pub invoice_decimals: u32,
}

pub fn currency_spec(code: &[u8]) -> CurrencySpec {
    let mut up = [0u8; 8];
    let mut n = 0usize;
    for &b in code {
        if !b.is_ascii_whitespace() && n < up.len() {
            up[n] = b.to_ascii_uppercase();
            n += 1;
        }
    }
    match &up[..n] {
        b"" | b"MAD" | b"DH" | b"MADH" => CurrencySpec { minor_decimals: 2, invoice_decimals: 0 },
        b"TND" | b"KWD" | b"BHD" | b"OMR" | b"JOD" => CurrencySpec { minor_decimals: 3, invoice_decimals: 3 },
        b"JPY" => CurrencySpec { minor_decimals: 0, invoice_decimals: 0 },
        _ => CurrencySpec { minor_decimals: 2, invoice_decimals: 2 },
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BulkTier {
    pub min_qty: f64,
    pub percent: f64,
}

/// Pick the highest qualifying `min_qty` tier and apply percentage discount (rounded to 2 decimals).
pub fn apply_bulk_discount(list_price: f64, qty: f64, tiers: &[BulkTier]) -> (f64, f64) {
    if !list_price.is_finite() || !qty.is_finite() || list_price <= 0.0 || qty <= 0.0 || tiers.is_empty() {
        return (if list_price.is_finite() && list_price >= 0.0 { list_price } else { 0.0 }, 0.0);
    }
    let mut best_min = -1.0_f64;
    let mut best_pct = 0.0_f64;
    for t in tiers {
        if t.min_qty.is_finite()
            && t.percent.is_finite()
            && t.min_qty > 0.0
            && t.percent > 0.0
            && t.percent <= 100.0
            && qty >= t.min_qty
            && t.min_qty > best_min
        {
            best_min = t.min_qty;
            best_pct = t.percent;
        }
    }
    if best_pct <= 0.0 {
        return (list_price, 0.0);
    }
    let unit = round2(list_price * (1.0 - best_pct / 100.0));
    (unit, best_pct)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineInput {
    pub quantity: f64,
    pub unit_price: f64,
    pub list_price: f64,
    pub tax_rate: f64,
    pub has_explicit_tax_rate: bool,
    pub default_tax: f64,
    pub prices_ttc: bool,
    pub is_quick_sale: bool,
    pub tax_exempt: bool,
    pub explicit_inclusive: bool,
    pub invoice_decimals: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineOutput {
    pub unit_ht: f64,
    pub list_ht: f64,
    pub stored_unit_price: f64,
    pub stored_list_price: f64,
    pub tax_rate: f64,
    pub line_ht: f64,
    pub line_tax_real: f64,
    pub line_ttc: f64,
    pub line_total: f64,
    pub discount_amount: f64,
    pub discount_percent: f64,
}

pub fn compute_invoice_line(inp: LineInput) -> LineOutput {
    let qty = if inp.quantity.is_finite() && inp.quantity > 0.0 { inp.quantity } else { 0.0 };
    let unit_p = if inp.unit_price.is_finite() && inp.unit_price >= 0.0 { inp.unit_price } else { 0.0 };
    let list_p = if inp.list_price.is_finite() && inp.list_price > 0.0 { inp.list_price } else { unit_p };
    let inv_decimals = inp.invoice_decimals.min(6);
    let safe_default_tax = if inp.default_tax.is_finite() && inp.default_tax >= 0.0 { inp.default_tax } else { 0.0 };

    let mut tax_rate = if inp.is_quick_sale {
        0.0
    } else if inp.has_explicit_tax_rate {
        inp.tax_rate
    } else {
        safe_default_tax
    };

    if !inp.is_quick_sale {
        if !tax_rate.is_finite() || tax_rate < 0.0 {
            tax_rate = safe_default_tax;
        }
        if !inp.tax_exempt && tax_rate == 0.0 && safe_default_tax > 0.0 {
            tax_rate = safe_default_tax;
        }
        if inp.tax_exempt {
            tax_rate = 0.0;
        }
    }

    let mut unit_ht = unit_p;
    let mut list_ht = list_p;
    if inp.prices_ttc && tax_rate > 0.0 {
        let factor = 1.0 + tax_rate / 100.0;
        unit_ht = unit_p / factor;
        list_ht = list_p / factor;
    }

    let line_ht = qty * unit_ht;
    let line_ttc = if inp.prices_ttc && tax_rate > 0.0 {
        qty * unit_p
    } else {
        line_ht * (1.0 + tax_rate / 100.0)
    };
    let line_tax_real = line_ttc - line_ht;
    let disc_amt = (list_ht - unit_ht).max(0.0) * qty;
    let disc_pct = if list_ht > 0.0 {
        ((list_ht - unit_ht) / list_ht * 100.0).max(0.0)
    } else {
        0.0
    };

    LineOutput {
        unit_ht,
        list_ht,
        stored_unit_price: if inp.explicit_inclusive { round6(unit_ht) } else { round_with_mode(unit_ht, inv_decimals, RoundingMode::HalfUp) },
        stored_list_price: if inp.explicit_inclusive { round6(list_ht) } else { round_with_mode(list_ht, inv_decimals, RoundingMode::HalfUp) },
        tax_rate,
        line_ht,
        line_tax_real,
        line_ttc,
        line_total: round_with_mode(line_ttc, inv_decimals, RoundingMode::HalfUp),
        discount_amount: disc_amt,
        discount_percent: disc_pct,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DocumentTotals {
    pub subtotal: f64,
    pub tax_amount: f64,
    pub total: f64,
}

pub fn aggregate_document_totals(lines: &[LineOutput], invoice_decimals: u32) -> DocumentTotals {
    let d = invoice_decimals.min(6);
    let mut sub = 0.0_f64;
    let mut tax = 0.0_f64;
    for l in lines {
        if l.line_ht.is_finite() {
            sub += l.line_ht;
        }
        if l.line_tax_real.is_finite() {
            tax += l.line_tax_real;
        }
    }
    let subtotal = round_with_mode(sub, d, RoundingMode::HalfUp);
    let tax_amount = round_with_mode(tax, d, RoundingMode::HalfUp);
    let total = add_money(subtotal, tax_amount, d);
    DocumentTotals { subtotal, tax_amount, total }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefundError {
    InvalidRefundTotal = 1,
    InvalidSourceTotal = 2,
    InvalidSourcePaid = 3,
    RefundExceedsSourceTotal = 4,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RefundSplit {
    pub credit_vs_debt: f64,
    pub cash_refund: f64,
    pub next_paid: f64,
    /// 0 = keep/sent, 1 = partial, 2 = paid
    pub status_code: u8,
}

/// Exact WR credit-note split against source invoice unpaid balance vs paid cash,
/// rejecting negative/non-finite inputs and clamping/rejecting invalid balances.
pub fn compute_refund_split(
    refund_total: f64,
    source_total: f64,
    source_paid: f64,
    source_status_is_paid: bool,
    invoice_decimals: u32,
) -> Result<RefundSplit, RefundError> {
    if !refund_total.is_finite() || refund_total < 0.0 {
        return Err(RefundError::InvalidRefundTotal);
    }
    if !source_total.is_finite() || source_total < 0.0 {
        return Err(RefundError::InvalidSourceTotal);
    }
    if !source_paid.is_finite() || source_paid < 0.0 {
        return Err(RefundError::InvalidSourcePaid);
    }

    let d = invoice_decimals.min(6);
    let total = round_with_mode(refund_total, d, RoundingMode::HalfUp);
    let src_total = round_with_mode(source_total, d, RoundingMode::HalfUp);
    let paid = source_paid.min(src_total);

    if total > src_total + 0.001 {
        return Err(RefundError::RefundExceedsSourceTotal);
    }

    let remaining = sub_money(src_total, paid, d).max(0.0);
    let fully_paid = remaining <= 0.001 || source_status_is_paid || paid + 0.001 >= src_total;

    let mut credit_vs_debt = if fully_paid { 0.0 } else { total.min(remaining) };
    let mut cash_refund = if fully_paid { total } else { sub_money(total, credit_vs_debt, d).max(0.0) };
    credit_vs_debt = round_with_mode(credit_vs_debt, d, RoundingMode::HalfUp);
    cash_refund = round_with_mode(cash_refund, d, RoundingMode::HalfUp);

    let mut next_paid = paid;
    let mut status_code = if source_status_is_paid { 2 } else { 0 };

    if credit_vs_debt > 0.001 {
        next_paid = add_money(paid, credit_vs_debt, d.max(2)).min(src_total).max(0.0);
        status_code = if next_paid >= src_total - 0.001 {
            2
        } else if next_paid > 0.001 {
            1
        } else if source_status_is_paid {
            2
        } else {
            0
        };
    } else if cash_refund > 0.001 {
        next_paid = paid;
        if fully_paid || paid >= src_total - 0.001 {
            status_code = 2;
        } else if paid > 0.001 {
            status_code = 1;
        }
    }

    Ok(RefundSplit {
        credit_vs_debt,
        cash_refund,
        next_paid,
        status_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_currency_specs() {
        assert_eq!(currency_spec(b"MAD"), CurrencySpec { minor_decimals: 2, invoice_decimals: 0 });
        assert_eq!(currency_spec(b"TND"), CurrencySpec { minor_decimals: 3, invoice_decimals: 3 });
        assert_eq!(currency_spec(b"JPY"), CurrencySpec { minor_decimals: 0, invoice_decimals: 0 });
        assert_eq!(currency_spec(b"EUR"), CurrencySpec { minor_decimals: 2, invoice_decimals: 2 });
    }

    #[test]
    fn test_bulk_discounts_highest_tier_wins() {
        let tiers = [
            BulkTier { min_qty: 10.0, percent: 5.0 },
            BulkTier { min_qty: 50.0, percent: 12.5 },
        ];
        assert_eq!(apply_bulk_discount(200.0, 9.0, &tiers), (200.0, 0.0));
        assert_eq!(apply_bulk_discount(200.0, 10.0, &tiers), (190.0, 5.0));
        assert_eq!(apply_bulk_discount(200.0, 50.0, &tiers), (175.0, 12.5));
    }

    #[test]
    fn test_invoice_line_multi_currency() {
        let out_eur = compute_invoice_line(LineInput {
            quantity: 1.375,
            unit_price: 245.5,
            list_price: 245.5,
            tax_rate: 20.0,
            has_explicit_tax_rate: true,
            default_tax: 20.0,
            prices_ttc: false,
            is_quick_sale: false,
            tax_exempt: false,
            explicit_inclusive: false,
            invoice_decimals: 2,
        });
        let tot_eur = aggregate_document_totals(&[out_eur], 2);
        assert_eq!(tot_eur.subtotal, 337.56);
        assert_eq!(tot_eur.tax_amount, 67.51);
        assert_eq!(tot_eur.total, 405.07);
    }

    #[test]
    fn test_refund_split_validation_and_conservation() {
        let partial = compute_refund_split(800.0, 1000.0, 400.0, false, 0).unwrap();
        assert_eq!(partial.credit_vs_debt, 600.0);
        assert_eq!(partial.cash_refund, 200.0);
        assert_eq!(partial.next_paid, 1000.0);
        assert_eq!(partial.status_code, 2);

        assert_eq!(compute_refund_split(-10.0, 1000.0, 0.0, false, 0), Err(RefundError::InvalidRefundTotal));
        assert_eq!(compute_refund_split(1200.0, 1000.0, 0.0, false, 0), Err(RefundError::RefundExceedsSourceTotal));
    }
}
