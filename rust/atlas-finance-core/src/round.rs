//! Deterministic rounding primitives matching Atlas Commerce's currency-aware rules:
//! - `round_dh`: exact IEEE-754 integer rounding matching JS `Math.round` (fixes `0.49999999999999994 -> 0`).
//! - `round_with_mode` / `round2` / `round6`: exact 15-sig-digit decimal scaling (fixes `35.855 -> 35.86`, `1.005 -> 1.01`)
//!   with overflow safety (`|v| >= 2^52 / 10^d` returns `v` directly, avoiding `1e307`/`1e303` Infinity overflow).

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoundingMode {
    HalfUp = 0,
    HalfEven = 1,
    Truncate = 2,
}

impl RoundingMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::HalfEven,
            2 => Self::Truncate,
            _ => Self::HalfUp,
        }
    }
}

/// Exact IEEE-754 integer rounding matching ECMAScript `Math.round`:
/// - Non-finite (`NaN`, `±Infinity`) -> `0.0`
/// - `-0.0` -> `+0.0`
/// - `0.49999999999999994` -> `0.0` (avoids `(v + 0.5).floor() == 1.0` ULP bug)
/// - `-0.5` -> `0.0`
#[inline]
pub fn js_math_round(v: f64) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    if v == 0.0 {
        return 0.0;
    }
    // Any |v| >= 2^52 is already an exact integer in IEEE-754 f64.
    if v.abs() >= 4_503_599_627_370_496.0 {
        return v;
    }
    let t = v.floor();
    let frac = v - t;
    let r = if frac >= 0.5 { t + 1.0 } else { t };
    if r == 0.0 { 0.0 } else { r }
}

#[inline]
fn pow10_f64(d: u32) -> f64 {
    match d {
        0 => 1.0,
        1 => 10.0,
        2 => 100.0,
        3 => 1_000.0,
        4 => 10_000.0,
        5 => 100_000.0,
        6 => 1_000_000.0,
        7 => 10_000_000.0,
        _ => 100_000_000.0,
    }
}

/// Exact decimal-digit scaling to integer at `decimals` places, matching `shared/financeCore.ts::scaleToIntegerWithMode`.
pub fn scale_to_integer_with_mode(value: f64, decimals: u32, mode: RoundingMode) -> Option<i64> {
    if !value.is_finite() {
        return Some(0);
    }
    let d = decimals.min(8);
    if value == 0.0 {
        return Some(0);
    }
    let factor = pow10_f64(d);
    if value.abs() >= 4_503_599_627_370_496.0 / factor {
        return None;
    }

    let neg = value < 0.0;
    let abs = value.abs();
    let s = format!("{:.14e}", abs);
    let (mant, exp_str) = match s.find('e') {
        Some(idx) => (&s[..idx], &s[idx + 1..]),
        None => (s.as_str(), "0"),
    };
    let mut exp10: i32 = exp_str.parse().unwrap_or(0);
    let mut digits = String::with_capacity(16);
    if let Some(dot_idx) = mant.find('.') {
        digits.push_str(&mant[..dot_idx]);
        digits.push_str(&mant[dot_idx + 1..]);
        exp10 -= (mant.len() - dot_idx - 1) as i32;
    } else {
        digits.push_str(mant);
    }

    let trimmed = digits.trim_start_matches('0');
    let digits = if trimmed.is_empty() { "0" } else { trimmed };
    let shift = exp10 + d as i32;

    let (int_str, frac_str) = if shift >= 0 {
        let mut out = String::with_capacity(digits.len() + shift as usize);
        out.push_str(digits);
        for _ in 0..shift {
            out.push('0');
        }
        (out, String::new())
    } else {
        let cut = digits.len() as i32 + shift;
        if cut <= 0 {
            let mut f = String::with_capacity((-cut) as usize + digits.len());
            for _ in 0..(-cut) {
                f.push('0');
            }
            f.push_str(digits);
            ("0".to_string(), f)
        } else {
            let c = cut as usize;
            (digits[..c].to_string(), digits[c..].to_string())
        }
    };

    let frac_trimmed = frac_str.trim_end_matches('0');
    let mut int_val: i64 = int_str.parse().unwrap_or(0);

    if !frac_trimmed.is_empty() && mode != RoundingMode::Truncate {
        let first_digit = frac_trimmed.as_bytes()[0] - b'0';
        let has_more = frac_trimmed.len() > 1;
        let round_up = match mode {
            RoundingMode::HalfUp => {
                if !neg {
                    first_digit >= 5
                } else {
                    first_digit > 5 || (first_digit == 5 && has_more)
                }
            }
            RoundingMode::HalfEven => {
                if first_digit > 5 || (first_digit == 5 && has_more) {
                    true
                } else if first_digit == 5 && !has_more {
                    int_val % 2 == 1
                } else {
                    false
                }
            }
            RoundingMode::Truncate => false,
        };
        if round_up {
            int_val += 1;
        }
    }

    let signed = if neg { -int_val } else { int_val };
    Some(if signed == 0 { 0 } else { signed })
}

pub fn round_with_mode(v: f64, decimals: u32, mode: RoundingMode) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    if v == 0.0 {
        return 0.0;
    }
    let d = decimals.min(8);
    if d == 0 && mode == RoundingMode::HalfUp {
        return js_math_round(v);
    }
    let factor = pow10_f64(d);
    if v.abs() >= 4_503_599_627_370_496.0 / factor {
        return v;
    }
    match scale_to_integer_with_mode(v, d, mode) {
        Some(0) => 0.0,
        Some(scaled) => {
            if d == 0 {
                scaled as f64
            } else {
                let out = (scaled as f64) / factor;
                if out == 0.0 { 0.0 } else { out }
            }
        }
        None => v,
    }
}

/// Half-up rounding to 2 decimals with exact decimal scaling (`35.855 -> 35.86`, `1.005 -> 1.01`, `-2.675 -> -2.67`).
#[inline]
pub fn round2(v: f64) -> f64 {
    round_with_mode(v, 2, RoundingMode::HalfUp)
}

/// Moroccan Dirham integer rounding — exact JS `Math.round` semantics.
#[inline]
pub fn round_dh(v: f64) -> f64 {
    js_math_round(v)
}

/// 6-decimal precision rounding for inclusive-tax HT unit prices.
#[inline]
pub fn round6(v: f64) -> f64 {
    round_with_mode(v, 6, RoundingMode::HalfUp)
}

/// Exact integer minor-unit addition at `decimals` places, avoiding IEEE-754 drift.
pub fn add_money(a: f64, b: f64, decimals: u32) -> f64 {
    let d = decimals.min(6);
    match (
        scale_to_integer_with_mode(a, d, RoundingMode::HalfUp),
        scale_to_integer_with_mode(b, d, RoundingMode::HalfUp),
    ) {
        (Some(ia), Some(ib)) => {
            let sum = ia.saturating_add(ib);
            if d == 0 {
                sum as f64
            } else {
                let out = (sum as f64) / pow10_f64(d);
                if out == 0.0 { 0.0 } else { out }
            }
        }
        _ => round_with_mode(a + b, d, RoundingMode::HalfUp),
    }
}

/// Exact integer minor-unit subtraction (`a - b`) at `decimals` places.
pub fn sub_money(a: f64, b: f64, decimals: u32) -> f64 {
    let d = decimals.min(6);
    match (
        scale_to_integer_with_mode(a, d, RoundingMode::HalfUp),
        scale_to_integer_with_mode(b, d, RoundingMode::HalfUp),
    ) {
        (Some(ia), Some(ib)) => {
            let diff = ia.saturating_sub(ib);
            if d == 0 {
                diff as f64
            } else {
                let out = (diff as f64) / pow10_f64(d);
                if out == 0.0 { 0.0 } else { out }
            }
        }
        _ => round_with_mode(a - b, d, RoundingMode::HalfUp),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round2_exact_decimal_half_up_and_edge_cases() {
        assert_eq!(round2(1.005), 1.01);
        assert_eq!(round2(2.675), 2.68);
        assert_eq!(round2(10.125), 10.13);
        assert_eq!(round2(35.855), 35.86);
        assert_eq!(round2(10.124), 10.12);
        assert_eq!(round2(-2.675), -2.67);
        assert_eq!(round2(-0.0), 0.0);
        assert!(round2(-0.0).is_sign_positive());
        assert_eq!(round2(f64::NAN), 0.0);
        assert_eq!(round2(f64::INFINITY), 0.0);
        assert_eq!(round2(f64::NEG_INFINITY), 0.0);
        assert!(round2(1e307).is_finite());
        assert_eq!(round2(1e307), 1e307);
    }

    #[test]
    fn test_round_dh_matches_js_math_round_exactly() {
        assert_eq!(round_dh(12.5), 13.0);
        assert_eq!(round_dh(12.49), 12.0);
        assert_eq!(round_dh(0.49999999999999994), 0.0);
        assert_eq!(round_dh(-0.5), 0.0);
        assert!(round_dh(-0.5).is_sign_positive());
        assert_eq!(round_dh(-0.5000000000000001), -1.0);
        assert_eq!(round_dh(-1.5), -1.0);
        assert_eq!(round_dh(f64::NAN), 0.0);
        assert_eq!(round_dh(1e307), 1e307);
    }

    #[test]
    fn test_round6_and_overflow_safety() {
        assert_eq!(round6(100.0 / 1.2), 83.333333);
        assert!(round6(1e303).is_finite());
        assert_eq!(round6(1e303), 1e303);
    }
}
