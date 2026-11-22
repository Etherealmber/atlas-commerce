//! Deterministic calendar validation, document aging classification, and payroll accrual math.

use crate::round::{round2, sub_money};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ymd {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

#[inline]
pub fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

#[inline]
pub fn days_in_month(y: i32, m: u8) -> u8 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if is_leap_year(y) { 29 } else { 28 },
        _ => 0,
    }
}

#[inline]
pub fn is_valid_ymd(y: i32, m: u32, d: u32) -> bool {
    if !(1..=9999).contains(&y) || !(1..=12).contains(&m) || d == 0 {
        return false;
    }
    d <= days_in_month(y, m as u8) as u32
}

/// Howard Hinnant civil-from-days / days-from-civil algorithm (exact UTC calendar math).
#[inline]
pub fn days_from_civil(y: i32, m: u8, d: u8) -> i64 {
    let y = y as i64 - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let m = m as i64;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

#[inline]
pub fn civil_from_days(z: i64) -> Ymd {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    Ymd { year, month: m as u8, day: d as u8 }
}

pub fn add_days_ymd(ymd: Ymd, days: i64) -> Ymd {
    civil_from_days(days_from_civil(ymd.year, ymd.month, ymd.day) + days)
}

pub fn days_between_ymd(from: Ymd, to: Ymd) -> i64 {
    days_from_civil(to.year, to.month, to.day) - days_from_civil(from.year, from.month, from.day)
}

pub fn parse_ymd(s: &[u8]) -> Option<Ymd> {
    if s.len() < 10 || s[4] != b'-' || s[7] != b'-' {
        return None;
    }
    let y = parse_digits(&s[0..4])? as i32;
    let m = parse_digits(&s[5..7])? as u32;
    let d = parse_digits(&s[8..10])? as u32;
    if !is_valid_ymd(y, m, d) {
        return None;
    }
    Some(Ymd { year: y, month: m as u8, day: d as u8 })
}

fn parse_digits(bytes: &[u8]) -> Option<u32> {
    let mut acc = 0u32;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        acc = acc * 10 + (b - b'0') as u32;
    }
    Some(acc)
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocMoneyState {
    Paid = 0,
    Partial = 1,
    Unpaid = 2,
    Overdue = 3,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DocClassifyResult {
    pub state: DocMoneyState,
    pub remaining: f64,
    pub overdue: bool,
}

pub fn classify_doc(total: f64, paid: f64, due_ymd: Option<Ymd>, today_ymd: Ymd) -> DocClassifyResult {
    let t = round2(total);
    let p = round2(paid);
    let remaining = sub_money(t, p, 2).max(0.0);
    if remaining <= 0.005 {
        return DocClassifyResult {
            state: DocMoneyState::Paid,
            remaining: 0.0,
            overdue: false,
        };
    }
    let overdue = match due_ymd {
        Some(due) => days_between_ymd(due, today_ymd) > 0,
        None => false,
    };
    if overdue {
        return DocClassifyResult {
            state: DocMoneyState::Overdue,
            remaining,
            overdue: true,
        };
    }
    if p > 0.005 {
        return DocClassifyResult {
            state: DocMoneyState::Partial,
            remaining,
            overdue: false,
        };
    }
    DocClassifyResult {
        state: DocMoneyState::Unpaid,
        remaining,
        overdue: false,
    }
}

#[inline]
pub fn payroll_cycle_days(is_monthly: bool, custom_days: i32) -> i32 {
    if is_monthly {
        30
    } else if custom_days <= 0 {
        7
    } else {
        custom_days.clamp(1, 365)
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayrollError {
    InactiveOrZeroSalary = 1,
    InvalidCycle = 2,
    InvalidAdvance = 3,
    InvalidDate = 4,
    Overflow = 5,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PayrollObligationCalc {
    pub amount_due: f64,
    pub daily_rate: f64,
    pub period_from: Ymd,
    pub period_to: Ymd,
    pub due_date: Ymd,
}

pub fn compute_payroll_obligation(
    active: bool,
    pay_amount: f64,
    cycle_days: i32,
    anchor: Ymd,
    as_of: Ymd,
    advances_in_period: f64,
) -> Result<PayrollObligationCalc, PayrollError> {
    if !active || !pay_amount.is_finite() || pay_amount <= 0.0 {
        return Err(PayrollError::InactiveOrZeroSalary);
    }
    if pay_amount > 1e12 {
        return Err(PayrollError::Overflow);
    }
    if !(1..=365).contains(&cycle_days) {
        return Err(PayrollError::InvalidCycle);
    }
    if !advances_in_period.is_finite() || advances_in_period < 0.0 {
        return Err(PayrollError::InvalidAdvance);
    }
    if !is_valid_ymd(anchor.year, anchor.month as u32, anchor.day as u32)
        || !is_valid_ymd(as_of.year, as_of.month as u32, as_of.day as u32)
    {
        return Err(PayrollError::InvalidDate);
    }
    let due_date = add_days_ymd(anchor, cycle_days as i64);
    let raw_elapsed = days_between_ymd(anchor, as_of);
    let elapsed = raw_elapsed.clamp(0, cycle_days as i64) as f64;
    let daily_rate = round2(pay_amount / cycle_days as f64);
    let gross = round2((elapsed / cycle_days as f64) * pay_amount);
    let adv = round2(advances_in_period).max(0.0);
    let net = sub_money(gross, adv, 2).max(0.0);
    Ok(PayrollObligationCalc {
        amount_due: net,
        daily_rate,
        period_from: anchor,
        period_to: due_date,
        due_date,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calendar_validation_and_leap_years() {
        assert!(is_valid_ymd(2024, 2, 29));
        assert!(!is_valid_ymd(2026, 2, 29));
        assert!(!is_valid_ymd(2026, 2, 31));
        assert!(!is_valid_ymd(2026, 4, 31));
        assert!(!is_valid_ymd(2026, 13, 1));
        assert!(!is_valid_ymd(2026, 0, 10));
        assert!(parse_ymd(b"2026-02-31").is_none());
        assert!(parse_ymd(b"2024-02-29").is_some());

        let d = Ymd { year: 2024, month: 2, day: 28 };
        assert_eq!(add_days_ymd(d, 1), Ymd { year: 2024, month: 2, day: 29 });
        assert_eq!(add_days_ymd(d, 2), Ymd { year: 2024, month: 3, day: 1 });
        assert_eq!(days_between_ymd(Ymd { year: 2026, month: 1, day: 1 }, Ymd { year: 2026, month: 1, day: 31 }), 30);
    }

    #[test]
    fn test_classify_doc() {
        let today = Ymd { year: 2026, month: 10, day: 20 };
        let past = Some(Ymd { year: 2026, month: 10, day: 10 });
        let future = Some(Ymd { year: 2026, month: 10, day: 30 });

        assert_eq!(classify_doc(100.0, 100.0, past, today).state, DocMoneyState::Paid);
        assert_eq!(classify_doc(100.0, 20.0, past, today).state, DocMoneyState::Overdue);
        assert_eq!(classify_doc(100.0, 20.0, future, today).state, DocMoneyState::Partial);
        assert_eq!(classify_doc(100.0, 0.0, future, today).state, DocMoneyState::Unpaid);
    }

    #[test]
    fn test_payroll_obligation_and_errors() {
        let anchor = Ymd { year: 2026, month: 10, day: 1 };
        let as_of = Ymd { year: 2026, month: 10, day: 16 };
        let ob = compute_payroll_obligation(true, 3000.0, 30, anchor, as_of, 250.0).unwrap();
        assert_eq!(ob.daily_rate, 100.0);
        assert_eq!(ob.amount_due, 1250.0);
        assert_eq!(ob.due_date, Ymd { year: 2026, month: 10, day: 31 });

        assert_eq!(
            compute_payroll_obligation(true, 3000.0, 0, anchor, as_of, 0.0),
            Err(PayrollError::InvalidCycle)
        );
        assert_eq!(
            compute_payroll_obligation(true, 3000.0, 30, anchor, as_of, -10.0),
            Err(PayrollError::InvalidAdvance)
        );
        assert_eq!(
            compute_payroll_obligation(false, 3000.0, 30, anchor, as_of, 0.0),
            Err(PayrollError::InactiveOrZeroSalary)
        );
    }
}
