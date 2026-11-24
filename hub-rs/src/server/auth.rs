use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Instant;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::server::error::ApiError;
use crate::server::AppState;

#[derive(Debug, Clone, Copy)]
pub struct AuthContext {
    pub loopback: bool,
}

pub fn is_loopback(addr: &std::net::SocketAddr) -> bool {
    addr.ip().is_loopback()
}

fn sha256(value: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher.finalize().into()
}

pub fn tokens_equal(candidate: Option<&str>, expected: &str) -> bool {
    let Some(candidate) = candidate else {
        return false;
    };
    sha256(candidate).ct_eq(&sha256(expected)).into()
}

pub fn token_from_request(headers: &HeaderMap, query: Option<&str>) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    if let Some(query) = query {
        for pair in query.split('&') {
            if let Some((key, value)) = pair.split_once('=') {
                if key == "t" && !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }

    if let Some(cookie) = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
    {
        for part in cookie.split(';') {
            let part = part.trim();
            if let Some((key, value)) = part.split_once('=') {
                if key == "ffbeast_token" && !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }

    None
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
    rate_per_second: f64,
    burst: f64,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    pub fn new(rate_per_second: f64, burst: f64) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            rate_per_second,
            burst,
        }
    }

    pub fn allow(&self, ip: IpAddr) -> bool {
        let Ok(mut buckets) = self.buckets.lock() else {
            return false;
        };
        let now = Instant::now();
        let bucket = buckets.entry(ip).or_insert(Bucket {
            tokens: self.burst,
            last: now,
        });
        let elapsed = now.duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.rate_per_second).min(self.burst);
        bucket.last = now;
        if bucket.tokens < 1.0 {
            return false;
        }
        bucket.tokens -= 1.0;
        true
    }
}

pub async fn require_auth(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    mut request: Request,
    next: Next,
) -> Response {
    if !state.rate_limiter.allow(addr.ip()) {
        return ApiError::rate_limited().into_response();
    }

    let token = token_from_request(request.headers(), request.uri().query());
    let expected = state
        .config
        .read()
        .expect("config lock")
        .token
        .clone();
    if !tokens_equal(token.as_deref(), &expected) {
        return ApiError::unauthorized().into_response();
    }

    request
        .extensions_mut()
        .insert(AuthContext {
            loopback: is_loopback(&addr),
        });
    next.run(request).await
}
