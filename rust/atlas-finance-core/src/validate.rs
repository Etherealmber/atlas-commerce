//! Deterministic input validation rules shared between Rust core and TypeScript API layer.

#[inline]
pub fn is_valid_credit_prefix(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.len() > 12 {
        return false;
    }
    if !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    for &b in bytes {
        if !(b.is_ascii_alphanumeric() || b == b'-' || b == b'/') {
            return false;
        }
    }
    true
}

#[inline]
pub fn is_valid_next_credit_number(n: f64) -> bool {
    n.is_finite() && n >= 1.0 && n <= 999_999_999.0 && n.floor() == n
}

#[inline]
pub fn is_valid_period_str(bytes: &[u8]) -> bool {
    if bytes.len() != 7 || bytes[4] != b'-' {
        return false;
    }
    for &b in &bytes[0..4] {
        if !b.is_ascii_digit() {
            return false;
        }
    }
    let m1 = bytes[5];
    let m2 = bytes[6];
    if !m1.is_ascii_digit() || !m2.is_ascii_digit() {
        return false;
    }
    let month = (m1 - b'0') * 10 + (m2 - b'0');
    (1..=12).contains(&month)
}

#[inline]
pub fn is_valid_non_negative_amount(v: f64, max: f64) -> bool {
    v.is_finite() && v >= 0.0 && v <= max
}

#[inline]
pub fn is_valid_positive_amount(v: f64, max: f64) -> bool {
    v.is_finite() && v > 0.0 && v <= max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credit_prefix_and_period() {
        assert!(is_valid_credit_prefix(b"WR-"));
        assert!(is_valid_credit_prefix(b"AVOIR/2026"));
        assert!(!is_valid_credit_prefix(b""));
        assert!(!is_valid_credit_prefix(b"-WR"));
        assert!(!is_valid_credit_prefix(b"TOOLONGPREFIX"));
        assert!(!is_valid_credit_prefix(b"WR$"));

        assert!(is_valid_next_credit_number(1.0));
        assert!(is_valid_next_credit_number(999_999_999.0));
        assert!(!is_valid_next_credit_number(0.0));
        assert!(!is_valid_next_credit_number(1.5));
        assert!(!is_valid_next_credit_number(f64::NAN));
        assert!(!is_valid_next_credit_number(1_000_000_000.0));

        assert!(is_valid_period_str(b"2026-10"));
        assert!(!is_valid_period_str(b"2026-13"));
        assert!(!is_valid_period_str(b"2026-00"));
        assert!(!is_valid_period_str(b"2026-1"));
    }
}
