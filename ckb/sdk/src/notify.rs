// ============ Notify Module ============
// Event Notification System — tracking and filtering on-chain events for monitoring,
// alerting, and analytics. Covers swap events, liquidations, governance proposals,
// circuit breaker trips, and protocol health alerts.
//
// All functions are standalone pub fn. No traits, no impl blocks.

// ============ Constants ============

/// Default max events in ring buffer
pub const DEFAULT_MAX_EVENTS: usize = 10_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum NotifyError {
    EventNotFound,
    SubscriptionNotFound,
    DuplicateSubscription,
    InvalidFilter,
    LogFull,
    NotificationFailed,
    SubscriptionInactive,
    InvalidSeverity,
    NoMatchingEvents,
    Overflow,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum EventType {
    Swap,
    LiquidityAdd,
    LiquidityRemove,
    Stake,
    Unstake,
    GovernanceProposal,
    GovernanceVote,
    CircuitBreakerTrip,
    CircuitBreakerReset,
    PriceAlert,
    VolumeAlert,
    LargeTransaction,
    SlashEvent,
    RewardDistribution,
    ConfigChange,
    EmergencyAction,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Severity {
    Info,
    Warning,
    Critical,
    Emergency,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FilterOp {
    Equals(u64),
    GreaterThan(u64),
    LessThan(u64),
    Between(u64, u64),
    Any,
}

#[derive(Debug, Clone)]
pub struct Event {
    pub event_id: u64,
    pub event_type: EventType,
    pub severity: Severity,
    pub timestamp: u64,
    pub block_height: u64,
    pub source: [u8; 32],
    pub actor: [u8; 32],
    pub value: u64,
    pub secondary_value: u64,
    pub data_hash: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct Subscription {
    pub sub_id: u64,
    pub subscriber: [u8; 32],
    pub event_types: Vec<EventType>,
    pub min_severity: Severity,
    pub source_filter: Option<[u8; 32]>,
    pub value_filter: FilterOp,
    pub created_at: u64,
    pub active: bool,
    pub notification_count: u64,
}

#[derive(Debug, Clone)]
pub struct Notification {
    pub notification_id: u64,
    pub subscription_id: u64,
    pub event: Event,
    pub delivered: bool,
    pub delivered_at: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct EventLog {
    pub events: Vec<Event>,
    pub subscriptions: Vec<Subscription>,
    pub notifications: Vec<Notification>,
    pub next_event_id: u64,
    pub next_sub_id: u64,
    pub next_notification_id: u64,
    pub max_events: usize,
    pub total_events_processed: u64,
}

#[derive(Debug, Clone)]
pub struct EventStats {
    pub total_events: u64,
    pub events_by_type: Vec<(EventType, u64)>,
    pub events_by_severity: Vec<(Severity, u64)>,
    pub avg_events_per_block: u64,
    pub peak_events_block: u64,
    pub active_subscriptions: u64,
    pub total_notifications: u64,
    pub delivery_rate_bps: u64,
}

// ============ Event Log Management ============

pub fn create_event_log(max_events: usize) -> EventLog {
    EventLog {
        events: Vec::new(),
        subscriptions: Vec::new(),
        notifications: Vec::new(),
        next_event_id: 1,
        next_sub_id: 1,
        next_notification_id: 1,
        max_events,
        total_events_processed: 0,
    }
}

pub fn emit_event(
    log: &mut EventLog,
    event_type: EventType,
    severity: Severity,
    timestamp: u64,
    block_height: u64,
    source: [u8; 32],
    actor: [u8; 32],
    value: u64,
    secondary: u64,
) -> u64 {
    let event_id = log.next_event_id;
    log.next_event_id = log.next_event_id.saturating_add(1);
    log.total_events_processed = log.total_events_processed.saturating_add(1);

    let mut data_hash = [0u8; 32];
    let bytes = value.to_le_bytes();
    for i in 0..8 {
        data_hash[i] = bytes[i];
    }
    let bytes2 = secondary.to_le_bytes();
    for i in 0..8 {
        data_hash[8 + i] = bytes2[i];
    }

    let event = Event {
        event_id,
        event_type,
        severity,
        timestamp,
        block_height,
        source,
        actor,
        value,
        secondary_value: secondary,
        data_hash,
    };

    log.events.push(event);

    if log.events.len() > log.max_events {
        trim_to_capacity(log);
    }

    event_id
}

pub fn get_event(log: &EventLog, event_id: u64) -> Option<&Event> {
    log.events.iter().find(|e| e.event_id == event_id)
}

pub fn event_count(log: &EventLog) -> usize {
    log.events.len()
}

pub fn clear_old_events(log: &mut EventLog, before: u64) -> usize {
    let original = log.events.len();
    log.events.retain(|e| e.timestamp >= before);
    original - log.events.len()
}

// ============ Event Queries ============

pub fn events_by_type<'a>(log: &'a EventLog, event_type: &EventType) -> Vec<&'a Event> {
    log.events.iter().filter(|e| &e.event_type == event_type).collect()
}

pub fn events_by_severity<'a>(log: &'a EventLog, min_severity: &Severity) -> Vec<&'a Event> {
    let min_ord = severity_ord(min_severity);
    log.events.iter().filter(|e| severity_ord(&e.severity) >= min_ord).collect()
}

pub fn events_by_source<'a>(log: &'a EventLog, source: &[u8; 32]) -> Vec<&'a Event> {
    log.events.iter().filter(|e| &e.source == source).collect()
}

pub fn events_by_actor<'a>(log: &'a EventLog, actor: &[u8; 32]) -> Vec<&'a Event> {
    log.events.iter().filter(|e| &e.actor == actor).collect()
}

pub fn events_in_range<'a>(log: &'a EventLog, start: u64, end: u64) -> Vec<&'a Event> {
    log.events.iter().filter(|e| e.timestamp >= start && e.timestamp <= end).collect()
}

pub fn events_at_block<'a>(log: &'a EventLog, block_height: u64) -> Vec<&'a Event> {
    log.events.iter().filter(|e| e.block_height == block_height).collect()
}

pub fn recent_events<'a>(log: &'a EventLog, count: usize) -> Vec<&'a Event> {
    let len = log.events.len();
    if count >= len {
        log.events.iter().collect()
    } else {
        log.events[len - count..].iter().collect()
    }
}

pub fn filter_events<'a>(
    log: &'a EventLog,
    event_type: Option<&EventType>,
    severity: Option<&Severity>,
    value_filter: &FilterOp,
) -> Vec<&'a Event> {
    log.events
        .iter()
        .filter(|e| {
            if let Some(et) = event_type {
                if &e.event_type != et {
                    return false;
                }
            }
            if let Some(sev) = severity {
                if severity_ord(&e.severity) < severity_ord(sev) {
                    return false;
                }
            }
            matches_filter(e.value, value_filter)
        })
        .collect()
}

// ============ Subscriptions ============

pub fn subscribe(
    log: &mut EventLog,
    subscriber: [u8; 32],
    event_types: Vec<EventType>,
    min_severity: Severity,
    source: Option<[u8; 32]>,
    value_filter: FilterOp,
    now: u64,
) -> Result<u64, NotifyError> {
    for sub in &log.subscriptions {
        if sub.subscriber == subscriber
            && sub.event_types == event_types
            && sub.source_filter == source
            && sub.active
        {
            return Err(NotifyError::DuplicateSubscription);
        }
    }

    let sub_id = log.next_sub_id;
    log.next_sub_id = log.next_sub_id.saturating_add(1);

    log.subscriptions.push(Subscription {
        sub_id,
        subscriber,
        event_types,
        min_severity,
        source_filter: source,
        value_filter,
        created_at: now,
        active: true,
        notification_count: 0,
    });

    Ok(sub_id)
}

pub fn unsubscribe(log: &mut EventLog, sub_id: u64) -> Result<(), NotifyError> {
    let idx = log.subscriptions.iter().position(|s| s.sub_id == sub_id);
    match idx {
        Some(i) => {
            log.subscriptions.remove(i);
            Ok(())
        }
        None => Err(NotifyError::SubscriptionNotFound),
    }
}

pub fn pause_subscription(log: &mut EventLog, sub_id: u64) -> Result<(), NotifyError> {
    match log.subscriptions.iter_mut().find(|s| s.sub_id == sub_id) {
        Some(sub) => {
            if !sub.active {
                return Err(NotifyError::SubscriptionInactive);
            }
            sub.active = false;
            Ok(())
        }
        None => Err(NotifyError::SubscriptionNotFound),
    }
}

pub fn resume_subscription(log: &mut EventLog, sub_id: u64) -> Result<(), NotifyError> {
    match log.subscriptions.iter_mut().find(|s| s.sub_id == sub_id) {
        Some(sub) => {
            sub.active = true;
            Ok(())
        }
        None => Err(NotifyError::SubscriptionNotFound),
    }
}

pub fn get_subscription(log: &EventLog, sub_id: u64) -> Option<&Subscription> {
    log.subscriptions.iter().find(|s| s.sub_id == sub_id)
}

pub fn subscriptions_for<'a>(log: &'a EventLog, subscriber: &[u8; 32]) -> Vec<&'a Subscription> {
    log.subscriptions.iter().filter(|s| &s.subscriber == subscriber).collect()
}

pub fn active_subscription_count(log: &EventLog) -> usize {
    log.subscriptions.iter().filter(|s| s.active).count()
}

// ============ Notification Matching ============

pub fn matches_subscription(event: &Event, sub: &Subscription) -> bool {
    if !sub.active {
        return false;
    }
    if !sub.event_types.contains(&event.event_type) {
        return false;
    }
    if !meets_severity(&event.severity, &sub.min_severity) {
        return false;
    }
    if let Some(ref src) = sub.source_filter {
        if &event.source != src {
            return false;
        }
    }
    matches_filter(event.value, &sub.value_filter)
}

pub fn matches_filter(value: u64, filter: &FilterOp) -> bool {
    match filter {
        FilterOp::Equals(v) => value == *v,
        FilterOp::GreaterThan(v) => value > *v,
        FilterOp::LessThan(v) => value < *v,
        FilterOp::Between(lo, hi) => value >= *lo && value <= *hi,
        FilterOp::Any => true,
    }
}

pub fn severity_ord(severity: &Severity) -> u8 {
    match severity {
        Severity::Info => 0,
        Severity::Warning => 1,
        Severity::Critical => 2,
        Severity::Emergency => 3,
    }
}

pub fn meets_severity(event_severity: &Severity, min_severity: &Severity) -> bool {
    severity_ord(event_severity) >= severity_ord(min_severity)
}

pub fn process_event(log: &mut EventLog, event_id: u64) -> Vec<u64> {
    let event = match log.events.iter().find(|e| e.event_id == event_id) {
        Some(e) => e.clone(),
        None => return Vec::new(),
    };

    let mut notification_ids = Vec::new();
    let matching_sub_indices: Vec<usize> = log
        .subscriptions
        .iter()
        .enumerate()
        .filter(|(_, s)| matches_subscription(&event, s))
        .map(|(i, _)| i)
        .collect();

    for idx in &matching_sub_indices {
        let nid = log.next_notification_id;
        log.next_notification_id = log.next_notification_id.saturating_add(1);

        log.notifications.push(Notification {
            notification_id: nid,
            subscription_id: log.subscriptions[*idx].sub_id,
            event: event.clone(),
            delivered: false,
            delivered_at: None,
        });

        log.subscriptions[*idx].notification_count =
            log.subscriptions[*idx].notification_count.saturating_add(1);

        notification_ids.push(nid);
    }

    notification_ids
}

pub fn pending_notifications(log: &EventLog) -> Vec<&Notification> {
    log.notifications.iter().filter(|n| !n.delivered).collect()
}

pub fn mark_delivered(log: &mut EventLog, notification_id: u64, now: u64) -> Result<(), NotifyError> {
    match log.notifications.iter_mut().find(|n| n.notification_id == notification_id) {
        Some(n) => {
            n.delivered = true;
            n.delivered_at = Some(now);
            Ok(())
        }
        None => Err(NotifyError::NotificationFailed),
    }
}

// ============ Alert Generation ============

pub fn price_alert(
    log: &mut EventLog,
    source: [u8; 32],
    price: u64,
    threshold: u64,
    now: u64,
    block: u64,
) -> Option<u64> {
    if price >= threshold {
        let severity = classify_severity(&EventType::PriceAlert, price, threshold);
        let eid = emit_event(log, EventType::PriceAlert, severity, now, block, source, [0u8; 32], price, threshold);
        Some(eid)
    } else {
        None
    }
}

pub fn volume_alert(
    log: &mut EventLog,
    source: [u8; 32],
    volume: u64,
    threshold: u64,
    now: u64,
    block: u64,
) -> Option<u64> {
    if volume >= threshold {
        let severity = classify_severity(&EventType::VolumeAlert, volume, threshold);
        let eid = emit_event(log, EventType::VolumeAlert, severity, now, block, source, [0u8; 32], volume, threshold);
        Some(eid)
    } else {
        None
    }
}

pub fn large_tx_alert(
    log: &mut EventLog,
    actor: [u8; 32],
    amount: u64,
    threshold: u64,
    now: u64,
    block: u64,
) -> Option<u64> {
    if amount >= threshold {
        let severity = classify_severity(&EventType::LargeTransaction, amount, threshold);
        let eid = emit_event(
            log,
            EventType::LargeTransaction,
            severity,
            now,
            block,
            [0u8; 32],
            actor,
            amount,
            threshold,
        );
        Some(eid)
    } else {
        None
    }
}

pub fn classify_severity(event_type: &EventType, value: u64, threshold: u64) -> Severity {
    if threshold == 0 {
        return Severity::Info;
    }
    let ratio = (value as u128).saturating_mul(100) / (threshold as u128);
    match event_type {
        EventType::CircuitBreakerTrip | EventType::EmergencyAction | EventType::SlashEvent => {
            if ratio >= 200 {
                Severity::Emergency
            } else if ratio >= 150 {
                Severity::Critical
            } else {
                Severity::Warning
            }
        }
        _ => {
            if ratio >= 500 {
                Severity::Emergency
            } else if ratio >= 300 {
                Severity::Critical
            } else if ratio >= 150 {
                Severity::Warning
            } else {
                Severity::Info
            }
        }
    }
}

// ============ Analytics ============

pub fn compute_stats(log: &EventLog) -> EventStats {
    let total_events = log.events.len() as u64;

    let all_types = vec![
        EventType::Swap,
        EventType::LiquidityAdd,
        EventType::LiquidityRemove,
        EventType::Stake,
        EventType::Unstake,
        EventType::GovernanceProposal,
        EventType::GovernanceVote,
        EventType::CircuitBreakerTrip,
        EventType::CircuitBreakerReset,
        EventType::PriceAlert,
        EventType::VolumeAlert,
        EventType::LargeTransaction,
        EventType::SlashEvent,
        EventType::RewardDistribution,
        EventType::ConfigChange,
        EventType::EmergencyAction,
    ];

    let events_by_type: Vec<(EventType, u64)> = all_types
        .into_iter()
        .map(|t| {
            let count = log.events.iter().filter(|e| e.event_type == t).count() as u64;
            (t, count)
        })
        .filter(|(_, c)| *c > 0)
        .collect();

    let events_by_severity = severity_distribution(log);

    let unique_blocks: std::collections::HashSet<u64> =
        log.events.iter().map(|e| e.block_height).collect();
    let avg_events_per_block = if unique_blocks.is_empty() {
        0
    } else {
        total_events / unique_blocks.len() as u64
    };

    let peak = busiest_block(log);
    let peak_events_block = peak.map(|(b, _)| b).unwrap_or(0);

    let active_subs = active_subscription_count(log) as u64;
    let total_notifs = log.notifications.len() as u64;
    let delivery_rate = notification_delivery_rate(log);

    EventStats {
        total_events,
        events_by_type,
        events_by_severity,
        avg_events_per_block,
        peak_events_block,
        active_subscriptions: active_subs,
        total_notifications: total_notifs,
        delivery_rate_bps: delivery_rate,
    }
}

pub fn event_frequency(log: &EventLog, event_type: &EventType, window_ms: u64, now: u64) -> u64 {
    let start = now.saturating_sub(window_ms);
    log.events
        .iter()
        .filter(|e| &e.event_type == event_type && e.timestamp >= start && e.timestamp <= now)
        .count() as u64
}

pub fn most_common_event(log: &EventLog) -> Option<EventType> {
    if log.events.is_empty() {
        return None;
    }

    let all_types = vec![
        EventType::Swap,
        EventType::LiquidityAdd,
        EventType::LiquidityRemove,
        EventType::Stake,
        EventType::Unstake,
        EventType::GovernanceProposal,
        EventType::GovernanceVote,
        EventType::CircuitBreakerTrip,
        EventType::CircuitBreakerReset,
        EventType::PriceAlert,
        EventType::VolumeAlert,
        EventType::LargeTransaction,
        EventType::SlashEvent,
        EventType::RewardDistribution,
        EventType::ConfigChange,
        EventType::EmergencyAction,
    ];

    let mut best_type = None;
    let mut best_count = 0u64;

    for t in all_types {
        let count = log.events.iter().filter(|e| e.event_type == t).count() as u64;
        if count > best_count {
            best_count = count;
            best_type = Some(t);
        }
    }

    best_type
}

pub fn busiest_block(log: &EventLog) -> Option<(u64, usize)> {
    if log.events.is_empty() {
        return None;
    }

    let mut counts: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();
    for e in &log.events {
        *counts.entry(e.block_height).or_insert(0) += 1;
    }

    counts.into_iter().max_by_key(|(_, c)| *c)
}

pub fn severity_distribution(log: &EventLog) -> Vec<(Severity, u64)> {
    let severities = vec![Severity::Info, Severity::Warning, Severity::Critical, Severity::Emergency];
    severities
        .into_iter()
        .map(|s| {
            let count = log.events.iter().filter(|e| e.severity == s).count() as u64;
            (s, count)
        })
        .collect()
}

pub fn notification_delivery_rate(log: &EventLog) -> u64 {
    let total = log.notifications.len() as u64;
    if total == 0 {
        return 0;
    }
    let delivered = log.notifications.iter().filter(|n| n.delivered).count() as u64;
    delivered.saturating_mul(10_000) / total
}

// ============ Ring Buffer ============

pub fn trim_to_capacity(log: &mut EventLog) -> usize {
    if log.events.len() <= log.max_events {
        return 0;
    }
    let excess = log.events.len() - log.max_events;
    log.events.drain(0..excess);
    excess
}

pub fn oldest_event(log: &EventLog) -> Option<&Event> {
    log.events.first()
}

pub fn newest_event(log: &EventLog) -> Option<&Event> {
    log.events.last()
}

pub fn capacity_remaining(log: &EventLog) -> usize {
    if log.events.len() >= log.max_events {
        0
    } else {
        log.max_events - log.events.len()
    }
}

// ============ Batch Operations ============

pub fn emit_batch(
    log: &mut EventLog,
    events: Vec<(EventType, Severity, u64, u64, [u8; 32], [u8; 32], u64, u64)>,
) -> Vec<u64> {
    events
        .into_iter()
        .map(|(et, sev, ts, bh, src, act, val, sec)| {
            emit_event(log, et, sev, ts, bh, src, act, val, sec)
        })
        .collect()
}

pub fn process_all_pending(log: &mut EventLog) -> usize {
    let event_ids: Vec<u64> = log.events.iter().map(|e| e.event_id).collect();
    let mut total = 0;
    for eid in event_ids {
        let already_notified = log.notifications.iter().any(|n| n.event.event_id == eid);
        if !already_notified {
            let nids = process_event(log, eid);
            total += nids.len();
        }
    }
    total
}

pub fn cleanup_delivered(log: &mut EventLog, before: u64) -> usize {
    let original = log.notifications.len();
    log.notifications.retain(|n| {
        if n.delivered {
            match n.delivered_at {
                Some(t) => t >= before,
                None => true,
            }
        } else {
            true
        }
    });
    original - log.notifications.len()
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn make_source(id: u8) -> [u8; 32] {
        let mut s = [0u8; 32];
        s[0] = id;
        s
    }

    fn make_actor(id: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[0] = id;
        a
    }

    // ---- Event Log Management (13 tests) ----

    #[test]
    fn test_create_event_log() {
        let log = create_event_log(100);
        assert_eq!(log.max_events, 100);
        assert_eq!(log.events.len(), 0);
        assert_eq!(log.next_event_id, 1);
    }

    #[test]
    fn test_create_event_log_zero_capacity() {
        let log = create_event_log(0);
        assert_eq!(log.max_events, 0);
    }

    #[test]
    fn test_create_event_log_large_capacity() {
        let log = create_event_log(1_000_000);
        assert_eq!(log.max_events, 1_000_000);
    }

    #[test]
    fn test_emit_event_returns_id() {
        let mut log = create_event_log(100);
        let id = emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 500, 10);
        assert_eq!(id, 1);
    }

    #[test]
    fn test_emit_event_increments_id() {
        let mut log = create_event_log(100);
        let id1 = emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 500, 10);
        let id2 = emit_event(&mut log, EventType::Stake, Severity::Warning, 2000, 11, make_source(2), make_actor(2), 600, 20);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_emit_event_stores_correctly() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Critical, 5000, 50, make_source(3), make_actor(4), 999, 88);
        let e = &log.events[0];
        assert_eq!(e.event_type, EventType::Swap);
        assert_eq!(e.severity, Severity::Critical);
        assert_eq!(e.timestamp, 5000);
        assert_eq!(e.block_height, 50);
        assert_eq!(e.value, 999);
        assert_eq!(e.secondary_value, 88);
    }

    #[test]
    fn test_emit_event_increments_total_processed() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 500, 10);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 500, 10);
        assert_eq!(log.total_events_processed, 2);
    }

    #[test]
    fn test_get_event_found() {
        let mut log = create_event_log(100);
        let id = emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 500, 10);
        let e = get_event(&log, id);
        assert!(e.is_some());
        assert_eq!(e.unwrap().value, 500);
    }

    #[test]
    fn test_get_event_not_found() {
        let log = create_event_log(100);
        assert!(get_event(&log, 999).is_none());
    }

    #[test]
    fn test_event_count_empty() {
        let log = create_event_log(100);
        assert_eq!(event_count(&log), 0);
    }

    #[test]
    fn test_event_count_after_emits() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 500, 10);
        emit_event(&mut log, EventType::Stake, Severity::Info, 2000, 11, make_source(1), make_actor(1), 600, 20);
        assert_eq!(event_count(&log), 2);
    }

    #[test]
    fn test_clear_old_events_removes_old() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 300, 3, make_source(1), make_actor(1), 30, 0);
        let removed = clear_old_events(&mut log, 250);
        assert_eq!(removed, 2);
        assert_eq!(log.events.len(), 1);
    }

    #[test]
    fn test_clear_old_events_removes_none() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 500, 1, make_source(1), make_actor(1), 10, 0);
        let removed = clear_old_events(&mut log, 100);
        assert_eq!(removed, 0);
    }

    // ---- Event Queries (18 tests) ----

    #[test]
    fn test_events_by_type_swap() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Warning, 3000, 12, make_source(1), make_actor(1), 300, 0);
        let swaps = events_by_type(&log, &EventType::Swap);
        assert_eq!(swaps.len(), 2);
    }

    #[test]
    fn test_events_by_type_no_match() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        let stakes = events_by_type(&log, &EventType::Stake);
        assert_eq!(stakes.len(), 0);
    }

    #[test]
    fn test_events_by_severity_warning_and_above() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Warning, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Critical, 3000, 12, make_source(1), make_actor(1), 300, 0);
        emit_event(&mut log, EventType::Swap, Severity::Emergency, 4000, 13, make_source(1), make_actor(1), 400, 0);
        let results = events_by_severity(&log, &Severity::Warning);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_events_by_severity_emergency_only() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Emergency, 2000, 11, make_source(1), make_actor(1), 200, 0);
        let results = events_by_severity(&log, &Severity::Emergency);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_events_by_severity_info_returns_all() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Critical, 2000, 11, make_source(1), make_actor(1), 200, 0);
        let results = events_by_severity(&log, &Severity::Info);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_events_by_source() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(2), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 12, make_source(1), make_actor(1), 300, 0);
        let results = events_by_source(&log, &make_source(1));
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_events_by_actor() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(5), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(6), 200, 0);
        let results = events_by_actor(&log, &make_actor(5));
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_events_by_actor_no_match() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(5), 100, 0);
        let results = events_by_actor(&log, &make_actor(99));
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_events_in_range() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 300, 3, make_source(1), make_actor(1), 30, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 400, 4, make_source(1), make_actor(1), 40, 0);
        let results = events_in_range(&log, 150, 350);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_events_in_range_inclusive() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        let results = events_in_range(&log, 100, 200);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_events_at_block() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 1001, 10, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 300, 0);
        let results = events_at_block(&log, 10);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_events_at_block_no_match() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        let results = events_at_block(&log, 999);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_recent_events_fewer_than_count() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        let results = recent_events(&log, 5);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_recent_events_exact_count() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        let results = recent_events(&log, 2);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_recent_events_returns_latest() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 12, make_source(1), make_actor(1), 300, 0);
        let results = recent_events(&log, 2);
        assert_eq!(results[0].value, 200);
        assert_eq!(results[1].value, 300);
    }

    #[test]
    fn test_filter_events_by_type_only() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        let results = filter_events(&log, Some(&EventType::Swap), None, &FilterOp::Any);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_filter_events_combined() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Warning, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Critical, 2000, 11, make_source(1), make_actor(1), 500, 0);
        emit_event(&mut log, EventType::Stake, Severity::Critical, 3000, 12, make_source(1), make_actor(1), 600, 0);
        let results = filter_events(&log, Some(&EventType::Swap), Some(&Severity::Critical), &FilterOp::GreaterThan(200));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].value, 500);
    }

    #[test]
    fn test_filter_events_between() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 50, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 150, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 12, make_source(1), make_actor(1), 250, 0);
        let results = filter_events(&log, None, None, &FilterOp::Between(100, 200));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].value, 150);
    }

    // ---- Subscriptions (16 tests) ----

    #[test]
    fn test_subscribe_returns_id() {
        let mut log = create_event_log(100);
        let sub_id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000);
        assert_eq!(sub_id, Ok(1));
    }

    #[test]
    fn test_subscribe_increments_id() {
        let mut log = create_event_log(100);
        let id1 = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let id2 = subscribe(&mut log, make_actor(2), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_subscribe_duplicate_rejected() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let r = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 2000);
        assert_eq!(r, Err(NotifyError::DuplicateSubscription));
    }

    #[test]
    fn test_subscribe_different_types_not_duplicate() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let r = subscribe(&mut log, make_actor(1), vec![EventType::Stake], Severity::Info, None, FilterOp::Any, 1000);
        assert!(r.is_ok());
    }

    #[test]
    fn test_subscribe_different_source_not_duplicate() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, Some(make_source(1)), FilterOp::Any, 1000).unwrap();
        let r = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, Some(make_source(2)), FilterOp::Any, 1000);
        assert!(r.is_ok());
    }

    #[test]
    fn test_unsubscribe_success() {
        let mut log = create_event_log(100);
        let id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        assert!(unsubscribe(&mut log, id).is_ok());
        assert_eq!(log.subscriptions.len(), 0);
    }

    #[test]
    fn test_unsubscribe_not_found() {
        let mut log = create_event_log(100);
        assert_eq!(unsubscribe(&mut log, 999), Err(NotifyError::SubscriptionNotFound));
    }

    #[test]
    fn test_pause_subscription() {
        let mut log = create_event_log(100);
        let id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        assert!(pause_subscription(&mut log, id).is_ok());
        assert!(!log.subscriptions[0].active);
    }

    #[test]
    fn test_pause_already_paused() {
        let mut log = create_event_log(100);
        let id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        pause_subscription(&mut log, id).unwrap();
        assert_eq!(pause_subscription(&mut log, id), Err(NotifyError::SubscriptionInactive));
    }

    #[test]
    fn test_pause_not_found() {
        let mut log = create_event_log(100);
        assert_eq!(pause_subscription(&mut log, 999), Err(NotifyError::SubscriptionNotFound));
    }

    #[test]
    fn test_resume_subscription() {
        let mut log = create_event_log(100);
        let id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        pause_subscription(&mut log, id).unwrap();
        assert!(resume_subscription(&mut log, id).is_ok());
        assert!(log.subscriptions[0].active);
    }

    #[test]
    fn test_resume_not_found() {
        let mut log = create_event_log(100);
        assert_eq!(resume_subscription(&mut log, 999), Err(NotifyError::SubscriptionNotFound));
    }

    #[test]
    fn test_get_subscription_found() {
        let mut log = create_event_log(100);
        let id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let sub = get_subscription(&log, id);
        assert!(sub.is_some());
        assert_eq!(sub.unwrap().subscriber, make_actor(1));
    }

    #[test]
    fn test_get_subscription_not_found() {
        let log = create_event_log(100);
        assert!(get_subscription(&log, 999).is_none());
    }

    #[test]
    fn test_subscriptions_for() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(1), vec![EventType::Stake], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(2), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let subs = subscriptions_for(&log, &make_actor(1));
        assert_eq!(subs.len(), 2);
    }

    #[test]
    fn test_active_subscription_count() {
        let mut log = create_event_log(100);
        let id1 = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(2), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        pause_subscription(&mut log, id1).unwrap();
        assert_eq!(active_subscription_count(&log), 1);
    }

    // ---- Notification Matching (22 tests) ----

    #[test]
    fn test_matches_filter_equals() {
        assert!(matches_filter(100, &FilterOp::Equals(100)));
        assert!(!matches_filter(101, &FilterOp::Equals(100)));
    }

    #[test]
    fn test_matches_filter_greater_than() {
        assert!(matches_filter(101, &FilterOp::GreaterThan(100)));
        assert!(!matches_filter(100, &FilterOp::GreaterThan(100)));
        assert!(!matches_filter(99, &FilterOp::GreaterThan(100)));
    }

    #[test]
    fn test_matches_filter_less_than() {
        assert!(matches_filter(99, &FilterOp::LessThan(100)));
        assert!(!matches_filter(100, &FilterOp::LessThan(100)));
    }

    #[test]
    fn test_matches_filter_between() {
        assert!(matches_filter(50, &FilterOp::Between(10, 100)));
        assert!(matches_filter(10, &FilterOp::Between(10, 100)));
        assert!(matches_filter(100, &FilterOp::Between(10, 100)));
        assert!(!matches_filter(9, &FilterOp::Between(10, 100)));
        assert!(!matches_filter(101, &FilterOp::Between(10, 100)));
    }

    #[test]
    fn test_matches_filter_any() {
        assert!(matches_filter(0, &FilterOp::Any));
        assert!(matches_filter(u64::MAX, &FilterOp::Any));
    }

    #[test]
    fn test_severity_ord_values() {
        assert_eq!(severity_ord(&Severity::Info), 0);
        assert_eq!(severity_ord(&Severity::Warning), 1);
        assert_eq!(severity_ord(&Severity::Critical), 2);
        assert_eq!(severity_ord(&Severity::Emergency), 3);
    }

    #[test]
    fn test_meets_severity_same_level() {
        assert!(meets_severity(&Severity::Warning, &Severity::Warning));
    }

    #[test]
    fn test_meets_severity_higher() {
        assert!(meets_severity(&Severity::Critical, &Severity::Warning));
    }

    #[test]
    fn test_meets_severity_lower() {
        assert!(!meets_severity(&Severity::Info, &Severity::Warning));
    }

    #[test]
    fn test_matches_subscription_basic() {
        let event = Event {
            event_id: 1, event_type: EventType::Swap, severity: Severity::Warning,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Info, source_filter: None, value_filter: FilterOp::Any,
            created_at: 500, active: true, notification_count: 0,
        };
        assert!(matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_inactive() {
        let event = Event {
            event_id: 1, event_type: EventType::Swap, severity: Severity::Warning,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Info, source_filter: None, value_filter: FilterOp::Any,
            created_at: 500, active: false, notification_count: 0,
        };
        assert!(!matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_wrong_type() {
        let event = Event {
            event_id: 1, event_type: EventType::Stake, severity: Severity::Warning,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Info, source_filter: None, value_filter: FilterOp::Any,
            created_at: 500, active: true, notification_count: 0,
        };
        assert!(!matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_severity_too_low() {
        let event = Event {
            event_id: 1, event_type: EventType::Swap, severity: Severity::Info,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Critical, source_filter: None, value_filter: FilterOp::Any,
            created_at: 500, active: true, notification_count: 0,
        };
        assert!(!matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_source_filter_match() {
        let event = Event {
            event_id: 1, event_type: EventType::Swap, severity: Severity::Warning,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Info, source_filter: Some(make_source(1)),
            value_filter: FilterOp::Any, created_at: 500, active: true, notification_count: 0,
        };
        assert!(matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_source_filter_mismatch() {
        let event = Event {
            event_id: 1, event_type: EventType::Swap, severity: Severity::Warning,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Info, source_filter: Some(make_source(99)),
            value_filter: FilterOp::Any, created_at: 500, active: true, notification_count: 0,
        };
        assert!(!matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_value_filter_fails() {
        let event = Event {
            event_id: 1, event_type: EventType::Swap, severity: Severity::Warning,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 500, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2), event_types: vec![EventType::Swap],
            min_severity: Severity::Info, source_filter: None,
            value_filter: FilterOp::GreaterThan(1000), created_at: 500, active: true,
            notification_count: 0,
        };
        assert!(!matches_subscription(&event, &sub));
    }

    #[test]
    fn test_matches_subscription_multi_event_types() {
        let event = Event {
            event_id: 1, event_type: EventType::Stake, severity: Severity::Info,
            timestamp: 1000, block_height: 10, source: make_source(1), actor: make_actor(1),
            value: 100, secondary_value: 0, data_hash: [0u8; 32],
        };
        let sub = Subscription {
            sub_id: 1, subscriber: make_actor(2),
            event_types: vec![EventType::Swap, EventType::Stake, EventType::Unstake],
            min_severity: Severity::Info, source_filter: None, value_filter: FilterOp::Any,
            created_at: 500, active: true, notification_count: 0,
        };
        assert!(matches_subscription(&event, &sub));
    }

    #[test]
    fn test_process_event_creates_notifications() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        assert_eq!(nids.len(), 1);
        assert_eq!(log.notifications.len(), 1);
    }

    #[test]
    fn test_process_event_no_match() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Stake], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        assert_eq!(nids.len(), 0);
    }

    #[test]
    fn test_process_event_multiple_subs() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(11), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        assert_eq!(nids.len(), 2);
    }

    #[test]
    fn test_process_event_increments_notification_count() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        process_event(&mut log, eid);
        assert_eq!(log.subscriptions[0].notification_count, 1);
    }

    // ---- Mark Delivered / Pending (5 tests) ----

    #[test]
    fn test_pending_notifications() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        process_event(&mut log, eid);
        assert_eq!(pending_notifications(&log).len(), 1);
    }

    #[test]
    fn test_pending_notifications_empty() {
        let log = create_event_log(100);
        assert_eq!(pending_notifications(&log).len(), 0);
    }

    #[test]
    fn test_mark_delivered_success() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        assert!(mark_delivered(&mut log, nids[0], 3000).is_ok());
        assert!(log.notifications[0].delivered);
        assert_eq!(log.notifications[0].delivered_at, Some(3000));
    }

    #[test]
    fn test_mark_delivered_not_found() {
        let mut log = create_event_log(100);
        assert_eq!(mark_delivered(&mut log, 999, 1000), Err(NotifyError::NotificationFailed));
    }

    #[test]
    fn test_mark_delivered_clears_pending() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        mark_delivered(&mut log, nids[0], 3000).unwrap();
        assert_eq!(pending_notifications(&log).len(), 0);
    }

    // ---- Alert Generation (14 tests) ----

    #[test]
    fn test_price_alert_triggered() {
        let mut log = create_event_log(100);
        let r = price_alert(&mut log, make_source(1), 150, 100, 1000, 10);
        assert!(r.is_some());
        assert_eq!(log.events[0].event_type, EventType::PriceAlert);
    }

    #[test]
    fn test_price_alert_not_triggered() {
        let mut log = create_event_log(100);
        let r = price_alert(&mut log, make_source(1), 50, 100, 1000, 10);
        assert!(r.is_none());
    }

    #[test]
    fn test_price_alert_exactly_at_threshold() {
        let mut log = create_event_log(100);
        let r = price_alert(&mut log, make_source(1), 100, 100, 1000, 10);
        assert!(r.is_some());
    }

    #[test]
    fn test_volume_alert_triggered() {
        let mut log = create_event_log(100);
        let r = volume_alert(&mut log, make_source(1), 200, 100, 1000, 10);
        assert!(r.is_some());
        assert_eq!(log.events[0].event_type, EventType::VolumeAlert);
    }

    #[test]
    fn test_volume_alert_not_triggered() {
        let mut log = create_event_log(100);
        let r = volume_alert(&mut log, make_source(1), 50, 100, 1000, 10);
        assert!(r.is_none());
    }

    #[test]
    fn test_volume_alert_at_threshold() {
        let mut log = create_event_log(100);
        let r = volume_alert(&mut log, make_source(1), 100, 100, 1000, 10);
        assert!(r.is_some());
    }

    #[test]
    fn test_large_tx_alert_triggered() {
        let mut log = create_event_log(100);
        let r = large_tx_alert(&mut log, make_actor(1), 1_000_000, 500_000, 1000, 10);
        assert!(r.is_some());
        assert_eq!(log.events[0].event_type, EventType::LargeTransaction);
    }

    #[test]
    fn test_large_tx_alert_not_triggered() {
        let mut log = create_event_log(100);
        let r = large_tx_alert(&mut log, make_actor(1), 100, 500_000, 1000, 10);
        assert!(r.is_none());
    }

    #[test]
    fn test_classify_severity_info() {
        assert_eq!(classify_severity(&EventType::Swap, 100, 100), Severity::Info);
    }

    #[test]
    fn test_classify_severity_warning() {
        assert_eq!(classify_severity(&EventType::Swap, 200, 100), Severity::Warning);
    }

    #[test]
    fn test_classify_severity_critical() {
        assert_eq!(classify_severity(&EventType::Swap, 350, 100), Severity::Critical);
    }

    #[test]
    fn test_classify_severity_emergency() {
        assert_eq!(classify_severity(&EventType::Swap, 600, 100), Severity::Emergency);
    }

    #[test]
    fn test_classify_severity_circuit_breaker_emergency() {
        assert_eq!(classify_severity(&EventType::CircuitBreakerTrip, 250, 100), Severity::Emergency);
    }

    #[test]
    fn test_classify_severity_zero_threshold() {
        assert_eq!(classify_severity(&EventType::Swap, 100, 0), Severity::Info);
    }

    // ---- Analytics (14 tests) ----

    #[test]
    fn test_compute_stats_empty() {
        let log = create_event_log(100);
        let stats = compute_stats(&log);
        assert_eq!(stats.total_events, 0);
        assert_eq!(stats.active_subscriptions, 0);
    }

    #[test]
    fn test_compute_stats_with_events() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Warning, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Stake, Severity::Critical, 3000, 12, make_source(1), make_actor(1), 300, 0);
        let stats = compute_stats(&log);
        assert_eq!(stats.total_events, 3);
    }

    #[test]
    fn test_compute_stats_events_by_type() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 3000, 12, make_source(1), make_actor(1), 300, 0);
        let stats = compute_stats(&log);
        let swap_count = stats.events_by_type.iter().find(|(t, _)| *t == EventType::Swap).map(|(_, c)| *c).unwrap_or(0);
        assert_eq!(swap_count, 2);
    }

    #[test]
    fn test_compute_stats_avg_events_per_block() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 10, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 20, make_source(1), make_actor(1), 300, 0);
        let stats = compute_stats(&log);
        assert_eq!(stats.avg_events_per_block, 1);
    }

    #[test]
    fn test_compute_stats_peak_block() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1001, 10, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1002, 10, make_source(1), make_actor(1), 300, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 400, 0);
        let stats = compute_stats(&log);
        assert_eq!(stats.peak_events_block, 10);
    }

    #[test]
    fn test_event_frequency() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 500, 5, make_source(1), make_actor(1), 50, 0);
        // window: now(500) - window_ms(300) = 200..500, events at 200 and 500 match
        let freq = event_frequency(&log, &EventType::Swap, 300, 500);
        assert_eq!(freq, 2);
    }

    #[test]
    fn test_event_frequency_empty() {
        let log = create_event_log(100);
        assert_eq!(event_frequency(&log, &EventType::Swap, 1000, 5000), 0);
    }

    #[test]
    fn test_most_common_event_single() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        assert_eq!(most_common_event(&log), Some(EventType::Swap));
    }

    #[test]
    fn test_most_common_event_multiple() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 3000, 12, make_source(1), make_actor(1), 300, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 4000, 13, make_source(1), make_actor(1), 400, 0);
        assert_eq!(most_common_event(&log), Some(EventType::Stake));
    }

    #[test]
    fn test_most_common_event_empty() {
        let log = create_event_log(100);
        assert_eq!(most_common_event(&log), None);
    }

    #[test]
    fn test_busiest_block() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1001, 10, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 300, 0);
        let (block, count) = busiest_block(&log).unwrap();
        assert_eq!(block, 10);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_busiest_block_empty() {
        let log = create_event_log(100);
        assert!(busiest_block(&log).is_none());
    }

    #[test]
    fn test_severity_distribution() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Swap, Severity::Warning, 3000, 12, make_source(1), make_actor(1), 300, 0);
        let dist = severity_distribution(&log);
        assert_eq!(dist[0], (Severity::Info, 2));
        assert_eq!(dist[1], (Severity::Warning, 1));
        assert_eq!(dist[3], (Severity::Emergency, 0));
    }

    #[test]
    fn test_notification_delivery_rate_none() {
        let log = create_event_log(100);
        assert_eq!(notification_delivery_rate(&log), 0);
    }

    // ---- Ring Buffer (8 tests) ----

    #[test]
    fn test_trim_to_capacity_no_trim() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        assert_eq!(trim_to_capacity(&mut log), 0);
    }

    #[test]
    fn test_trim_to_capacity_removes_oldest() {
        let mut log = create_event_log(3);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 300, 3, make_source(1), make_actor(1), 30, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 400, 4, make_source(1), make_actor(1), 40, 0);
        assert_eq!(log.events.len(), 3);
        assert_eq!(log.events[0].value, 20);
    }

    #[test]
    fn test_oldest_event() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        assert_eq!(oldest_event(&log).unwrap().value, 10);
    }

    #[test]
    fn test_oldest_event_empty() {
        let log = create_event_log(100);
        assert!(oldest_event(&log).is_none());
    }

    #[test]
    fn test_newest_event() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        assert_eq!(newest_event(&log).unwrap().value, 20);
    }

    #[test]
    fn test_newest_event_empty() {
        let log = create_event_log(100);
        assert!(newest_event(&log).is_none());
    }

    #[test]
    fn test_capacity_remaining_full() {
        let mut log = create_event_log(2);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        assert_eq!(capacity_remaining(&log), 0);
    }

    #[test]
    fn test_capacity_remaining_partial() {
        let mut log = create_event_log(10);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        assert_eq!(capacity_remaining(&log), 9);
    }

    // ---- Batch Operations (8 tests) ----

    #[test]
    fn test_emit_batch_returns_ids() {
        let mut log = create_event_log(100);
        let batch = vec![
            (EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0),
            (EventType::Stake, Severity::Warning, 2000, 11, make_source(2), make_actor(2), 200, 10),
            (EventType::Unstake, Severity::Critical, 3000, 12, make_source(3), make_actor(3), 300, 20),
        ];
        let ids = emit_batch(&mut log, batch);
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[test]
    fn test_emit_batch_empty() {
        let mut log = create_event_log(100);
        assert_eq!(emit_batch(&mut log, vec![]).len(), 0);
    }

    #[test]
    fn test_emit_batch_stores_all() {
        let mut log = create_event_log(100);
        let batch = vec![
            (EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0),
            (EventType::Stake, Severity::Info, 2000, 11, make_source(2), make_actor(2), 200, 0),
        ];
        emit_batch(&mut log, batch);
        assert_eq!(log.events.len(), 2);
    }

    #[test]
    fn test_process_all_pending() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap, EventType::Stake], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 3000, 21, make_source(1), make_actor(1), 200, 0);
        emit_event(&mut log, EventType::Unstake, Severity::Info, 4000, 22, make_source(1), make_actor(1), 300, 0);
        let total = process_all_pending(&mut log);
        assert_eq!(total, 2);
    }

    #[test]
    fn test_process_all_pending_no_subs() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        assert_eq!(process_all_pending(&mut log), 0);
    }

    #[test]
    fn test_process_all_pending_already_processed() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        process_event(&mut log, eid);
        assert_eq!(process_all_pending(&mut log), 0);
    }

    #[test]
    fn test_cleanup_delivered() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid1 = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        let eid2 = emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 21, make_source(1), make_actor(1), 200, 0);
        let nids1 = process_event(&mut log, eid1);
        let nids2 = process_event(&mut log, eid2);
        mark_delivered(&mut log, nids1[0], 2500).unwrap();
        mark_delivered(&mut log, nids2[0], 3500).unwrap();
        let removed = cleanup_delivered(&mut log, 3000);
        assert_eq!(removed, 1);
    }

    #[test]
    fn test_cleanup_delivered_keeps_undelivered() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        process_event(&mut log, eid);
        assert_eq!(cleanup_delivered(&mut log, 5000), 0);
    }

    // ---- Integration / Edge Cases (29 tests) ----

    #[test]
    fn test_full_lifecycle() {
        let mut log = create_event_log(100);
        let sub_id = subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Warning, None, FilterOp::GreaterThan(100), 1000).unwrap();
        let e1 = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 50, 0);
        let e2 = emit_event(&mut log, EventType::Swap, Severity::Warning, 3000, 21, make_source(1), make_actor(2), 200, 0);
        let e3 = emit_event(&mut log, EventType::Swap, Severity::Critical, 4000, 22, make_source(1), make_actor(3), 50, 0);
        assert_eq!(process_event(&mut log, e1).len(), 0);
        let n2 = process_event(&mut log, e2);
        assert_eq!(n2.len(), 1);
        assert_eq!(process_event(&mut log, e3).len(), 0);
        mark_delivered(&mut log, n2[0], 5000).unwrap();
        let stats = compute_stats(&log);
        assert_eq!(stats.total_events, 3);
        assert_eq!(stats.delivery_rate_bps, 10_000);
        assert_eq!(get_subscription(&log, sub_id).unwrap().notification_count, 1);
    }

    #[test]
    fn test_ring_buffer_overflow() {
        let mut log = create_event_log(5);
        for i in 0..10u64 {
            emit_event(&mut log, EventType::Swap, Severity::Info, i * 100, i, make_source(1), make_actor(1), i, 0);
        }
        assert_eq!(log.events.len(), 5);
        assert_eq!(log.total_events_processed, 10);
        assert_eq!(log.events[0].value, 5);
    }

    #[test]
    fn test_multiple_subscribers_same_event() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(11), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(12), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        assert_eq!(process_event(&mut log, eid).len(), 3);
    }

    #[test]
    fn test_paused_subscription_no_notifications() {
        let mut log = create_event_log(100);
        let sub_id = subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        pause_subscription(&mut log, sub_id).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        assert_eq!(process_event(&mut log, eid).len(), 0);
    }

    #[test]
    fn test_resumed_subscription_gets_notifications() {
        let mut log = create_event_log(100);
        let sub_id = subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        pause_subscription(&mut log, sub_id).unwrap();
        resume_subscription(&mut log, sub_id).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        assert_eq!(process_event(&mut log, eid).len(), 1);
    }

    #[test]
    fn test_alert_with_subscription() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::PriceAlert], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = price_alert(&mut log, make_source(1), 200, 100, 2000, 20).unwrap();
        assert_eq!(process_event(&mut log, eid).len(), 1);
    }

    #[test]
    fn test_events_by_type_governance() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::GovernanceProposal, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::GovernanceVote, Severity::Info, 2000, 11, make_source(1), make_actor(2), 200, 0);
        emit_event(&mut log, EventType::GovernanceProposal, Severity::Warning, 3000, 12, make_source(1), make_actor(3), 300, 0);
        assert_eq!(events_by_type(&log, &EventType::GovernanceProposal).len(), 2);
        assert_eq!(events_by_type(&log, &EventType::GovernanceVote).len(), 1);
    }

    #[test]
    fn test_subscribe_with_source_filter() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, Some(make_source(42)), FilterOp::Any, 1000).unwrap();
        let eid1 = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(42), make_actor(1), 100, 0);
        let eid2 = emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 21, make_source(99), make_actor(1), 200, 0);
        assert_eq!(process_event(&mut log, eid1).len(), 1);
        assert_eq!(process_event(&mut log, eid2).len(), 0);
    }

    #[test]
    fn test_data_hash_populated() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 12345, 67890);
        assert_ne!(log.events[0].data_hash, [0u8; 32]);
    }

    #[test]
    fn test_clear_old_events_preserves_newer() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 500, 5, make_source(1), make_actor(1), 50, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        clear_old_events(&mut log, 500);
        assert_eq!(log.events.len(), 2);
        assert_eq!(log.events[0].timestamp, 500);
    }

    #[test]
    fn test_circuit_breaker_event_flow() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::CircuitBreakerTrip, EventType::CircuitBreakerReset], Severity::Warning, None, FilterOp::Any, 1000).unwrap();
        let trip = emit_event(&mut log, EventType::CircuitBreakerTrip, Severity::Critical, 2000, 20, make_source(1), make_actor(1), 1000, 0);
        let reset = emit_event(&mut log, EventType::CircuitBreakerReset, Severity::Warning, 3000, 21, make_source(1), make_actor(1), 0, 0);
        assert_eq!(process_event(&mut log, trip).len(), 1);
        assert_eq!(process_event(&mut log, reset).len(), 1);
    }

    #[test]
    fn test_batch_with_ring_buffer() {
        let mut log = create_event_log(3);
        let batch = vec![
            (EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0),
            (EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0),
            (EventType::Swap, Severity::Info, 300, 3, make_source(1), make_actor(1), 30, 0),
            (EventType::Swap, Severity::Info, 400, 4, make_source(1), make_actor(1), 40, 0),
            (EventType::Swap, Severity::Info, 500, 5, make_source(1), make_actor(1), 50, 0),
        ];
        emit_batch(&mut log, batch);
        assert_eq!(log.events.len(), 3);
        assert_eq!(log.events[0].value, 30);
    }

    #[test]
    fn test_all_event_types_emit() {
        let mut log = create_event_log(100);
        let types = vec![
            EventType::Swap, EventType::LiquidityAdd, EventType::LiquidityRemove,
            EventType::Stake, EventType::Unstake, EventType::GovernanceProposal,
            EventType::GovernanceVote, EventType::CircuitBreakerTrip,
            EventType::CircuitBreakerReset, EventType::PriceAlert,
            EventType::VolumeAlert, EventType::LargeTransaction,
            EventType::SlashEvent, EventType::RewardDistribution,
            EventType::ConfigChange, EventType::EmergencyAction,
        ];
        for (i, t) in types.into_iter().enumerate() {
            emit_event(&mut log, t, Severity::Info, (i as u64) * 100, i as u64, make_source(1), make_actor(1), i as u64, 0);
        }
        assert_eq!(log.events.len(), 16);
    }

    #[test]
    fn test_subscribe_multiple_event_types() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap, EventType::LiquidityAdd, EventType::LiquidityRemove], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let e1 = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        let e2 = emit_event(&mut log, EventType::LiquidityAdd, Severity::Info, 3000, 21, make_source(1), make_actor(1), 200, 0);
        let e3 = emit_event(&mut log, EventType::Stake, Severity::Info, 4000, 22, make_source(1), make_actor(1), 300, 0);
        assert_eq!(process_event(&mut log, e1).len(), 1);
        assert_eq!(process_event(&mut log, e2).len(), 1);
        assert_eq!(process_event(&mut log, e3).len(), 0);
    }

    #[test]
    fn test_emergency_action_classification() {
        assert_eq!(classify_severity(&EventType::EmergencyAction, 100, 100), Severity::Warning);
    }

    #[test]
    fn test_slash_event_high_ratio() {
        assert_eq!(classify_severity(&EventType::SlashEvent, 300, 100), Severity::Emergency);
    }

    #[test]
    fn test_reward_distribution_event() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::RewardDistribution, Severity::Info, 1000, 10, make_source(1), make_actor(1), 5000, 100);
        let r = events_by_type(&log, &EventType::RewardDistribution);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].secondary_value, 100);
    }

    #[test]
    fn test_config_change_event() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::ConfigChange, Severity::Warning, 1000, 10, make_source(1), make_actor(1), 42, 100);
        assert_eq!(events_by_type(&log, &EventType::ConfigChange).len(), 1);
    }

    #[test]
    fn test_notification_delivery_rate_all() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        mark_delivered(&mut log, nids[0], 3000).unwrap();
        assert_eq!(notification_delivery_rate(&log), 10_000);
    }

    #[test]
    fn test_notification_delivery_rate_half() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(11), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 500, 0);
        let nids = process_event(&mut log, eid);
        mark_delivered(&mut log, nids[0], 3000).unwrap();
        assert_eq!(notification_delivery_rate(&log), 5_000);
    }

    #[test]
    fn test_unsubscribe_then_resubscribe() {
        let mut log = create_event_log(100);
        let id = subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        unsubscribe(&mut log, id).unwrap();
        assert!(subscribe(&mut log, make_actor(1), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 2000).is_ok());
    }

    #[test]
    fn test_process_all_pending_with_value_filter() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::GreaterThan(500), 1000).unwrap();
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 21, make_source(1), make_actor(1), 1000, 0);
        assert_eq!(process_all_pending(&mut log), 1);
    }

    #[test]
    fn test_multiple_alerts_same_source() {
        let mut log = create_event_log(100);
        price_alert(&mut log, make_source(1), 200, 100, 1000, 10);
        price_alert(&mut log, make_source(1), 300, 100, 2000, 20);
        volume_alert(&mut log, make_source(1), 500, 100, 3000, 30);
        assert_eq!(log.events.len(), 3);
    }

    #[test]
    fn test_emit_event_zero_values() {
        let mut log = create_event_log(100);
        let id = emit_event(&mut log, EventType::Swap, Severity::Info, 0, 0, [0u8; 32], [0u8; 32], 0, 0);
        assert_eq!(id, 1);
        assert_eq!(log.events[0].value, 0);
    }

    #[test]
    fn test_emit_event_max_values() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Emergency, u64::MAX, u64::MAX, [0xff; 32], [0xff; 32], u64::MAX, u64::MAX);
        assert_eq!(log.events[0].value, u64::MAX);
    }

    #[test]
    fn test_subscribe_value_filter_between() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Between(100, 500), 1000).unwrap();
        let e1 = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 50, 0);
        let e2 = emit_event(&mut log, EventType::Swap, Severity::Info, 3000, 21, make_source(1), make_actor(1), 300, 0);
        let e3 = emit_event(&mut log, EventType::Swap, Severity::Info, 4000, 22, make_source(1), make_actor(1), 600, 0);
        assert_eq!(process_event(&mut log, e1).len(), 0);
        assert_eq!(process_event(&mut log, e2).len(), 1);
        assert_eq!(process_event(&mut log, e3).len(), 0);
    }

    #[test]
    fn test_capacity_zero_auto_trims() {
        let mut log = create_event_log(0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        assert_eq!(log.events.len(), 0);
        assert_eq!(log.total_events_processed, 1);
    }

    #[test]
    fn test_large_tx_alert_records_actor() {
        let mut log = create_event_log(100);
        let actor = make_actor(42);
        large_tx_alert(&mut log, actor, 1_000_000, 500_000, 1000, 10);
        assert_eq!(log.events[0].actor, actor);
    }

    #[test]
    fn test_volume_alert_records_source() {
        let mut log = create_event_log(100);
        let src = make_source(77);
        volume_alert(&mut log, src, 500, 100, 1000, 10);
        assert_eq!(log.events[0].source, src);
    }

    #[test]
    fn test_process_event_nonexistent() {
        let mut log = create_event_log(100);
        assert_eq!(process_event(&mut log, 999).len(), 0);
    }

    #[test]
    fn test_cleanup_delivered_empty() {
        let mut log = create_event_log(100);
        assert_eq!(cleanup_delivered(&mut log, 5000), 0);
    }

    #[test]
    fn test_cleanup_delivered_boundary() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        let nids = process_event(&mut log, eid);
        mark_delivered(&mut log, nids[0], 3000).unwrap();
        assert_eq!(cleanup_delivered(&mut log, 3000), 0);
    }

    #[test]
    fn test_capacity_remaining_empty() {
        let log = create_event_log(100);
        assert_eq!(capacity_remaining(&log), 100);
    }

    #[test]
    fn test_recent_events_empty() {
        let log = create_event_log(100);
        assert_eq!(recent_events(&log, 5).len(), 0);
    }

    #[test]
    fn test_events_in_range_empty() {
        let log = create_event_log(100);
        assert_eq!(events_in_range(&log, 0, 1000).len(), 0);
    }

    #[test]
    fn test_severity_distribution_empty() {
        let log = create_event_log(100);
        let dist = severity_distribution(&log);
        for (_, count) in &dist {
            assert_eq!(*count, 0);
        }
    }

    #[test]
    fn test_event_frequency_all_in_window() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 900, 9, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 950, 9, make_source(1), make_actor(1), 20, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 30, 0);
        assert_eq!(event_frequency(&log, &EventType::Swap, 200, 1000), 3);
    }

    #[test]
    fn test_active_subscription_count_empty() {
        let log = create_event_log(100);
        assert_eq!(active_subscription_count(&log), 0);
    }

    #[test]
    fn test_subscriptions_for_none() {
        let log = create_event_log(100);
        assert_eq!(subscriptions_for(&log, &make_actor(99)).len(), 0);
    }

    #[test]
    fn test_clear_old_events_removes_all() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        assert_eq!(clear_old_events(&mut log, 999), 2);
        assert_eq!(log.events.len(), 0);
    }

    #[test]
    fn test_filter_events_no_filters_returns_all() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Stake, Severity::Warning, 2000, 11, make_source(1), make_actor(1), 200, 0);
        assert_eq!(filter_events(&log, None, None, &FilterOp::Any).len(), 2);
    }

    #[test]
    fn test_filter_events_by_severity_only() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Critical, 2000, 11, make_source(1), make_actor(1), 200, 0);
        assert_eq!(filter_events(&log, None, Some(&Severity::Critical), &FilterOp::Any).len(), 1);
    }

    #[test]
    fn test_filter_events_by_value_greater_than() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 500, 0);
        let r = filter_events(&log, None, None, &FilterOp::GreaterThan(200));
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].value, 500);
    }

    #[test]
    fn test_filter_events_less_than() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 50, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 150, 0);
        assert_eq!(filter_events(&log, None, None, &FilterOp::LessThan(100)).len(), 1);
    }

    #[test]
    fn test_filter_events_equals() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 1000, 10, make_source(1), make_actor(1), 100, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 11, make_source(1), make_actor(1), 200, 0);
        assert_eq!(filter_events(&log, None, None, &FilterOp::Equals(100)).len(), 1);
    }

    #[test]
    fn test_large_tx_at_threshold() {
        let mut log = create_event_log(100);
        assert!(large_tx_alert(&mut log, make_actor(1), 500_000, 500_000, 1000, 10).is_some());
    }

    #[test]
    fn test_classify_severity_circuit_breaker_critical() {
        assert_eq!(classify_severity(&EventType::CircuitBreakerTrip, 160, 100), Severity::Critical);
    }

    #[test]
    fn test_classify_severity_circuit_breaker_warning() {
        assert_eq!(classify_severity(&EventType::CircuitBreakerTrip, 120, 100), Severity::Warning);
    }

    #[test]
    fn test_classify_severity_slash_critical() {
        assert_eq!(classify_severity(&EventType::SlashEvent, 150, 100), Severity::Critical);
    }

    #[test]
    fn test_process_event_paused_sub_skipped() {
        let mut log = create_event_log(100);
        let s1 = subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(11), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        pause_subscription(&mut log, s1).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        let nids = process_event(&mut log, eid);
        assert_eq!(nids.len(), 1); // Only active sub gets notification
    }

    #[test]
    fn test_compute_stats_delivery_rate() {
        let mut log = create_event_log(100);
        subscribe(&mut log, make_actor(10), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        subscribe(&mut log, make_actor(11), vec![EventType::Swap], Severity::Info, None, FilterOp::Any, 1000).unwrap();
        let eid = emit_event(&mut log, EventType::Swap, Severity::Info, 2000, 20, make_source(1), make_actor(1), 100, 0);
        let nids = process_event(&mut log, eid);
        mark_delivered(&mut log, nids[0], 3000).unwrap();
        let stats = compute_stats(&log);
        assert_eq!(stats.total_notifications, 2);
        assert_eq!(stats.delivery_rate_bps, 5_000);
    }

    #[test]
    fn test_emit_batch_with_mixed_types() {
        let mut log = create_event_log(100);
        let batch = vec![
            (EventType::GovernanceProposal, Severity::Info, 1000, 10, make_source(1), make_actor(1), 1, 0),
            (EventType::GovernanceVote, Severity::Info, 2000, 11, make_source(1), make_actor(2), 1, 0),
            (EventType::CircuitBreakerTrip, Severity::Critical, 3000, 12, make_source(1), make_actor(3), 999, 0),
            (EventType::EmergencyAction, Severity::Emergency, 4000, 13, make_source(1), make_actor(4), 1000, 0),
        ];
        let ids = emit_batch(&mut log, batch);
        assert_eq!(ids.len(), 4);
        assert_eq!(events_by_type(&log, &EventType::GovernanceProposal).len(), 1);
        assert_eq!(events_by_type(&log, &EventType::CircuitBreakerTrip).len(), 1);
    }

    #[test]
    fn test_event_frequency_wrong_type_excluded() {
        let mut log = create_event_log(100);
        emit_event(&mut log, EventType::Swap, Severity::Info, 100, 1, make_source(1), make_actor(1), 10, 0);
        emit_event(&mut log, EventType::Stake, Severity::Info, 200, 2, make_source(1), make_actor(1), 20, 0);
        emit_event(&mut log, EventType::Swap, Severity::Info, 300, 3, make_source(1), make_actor(1), 30, 0);
        assert_eq!(event_frequency(&log, &EventType::Swap, 500, 500), 2);
        assert_eq!(event_frequency(&log, &EventType::Stake, 500, 500), 1);
    }
}
