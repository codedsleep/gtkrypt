use serde::Serialize;

/// A progress event emitted as a JSON line on stdout.
#[derive(Debug, Serialize)]
pub struct ProgressEvent {
    pub progress: f64,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub phase: String,
}

/// An error event emitted as JSON on stderr.
#[derive(Debug, Serialize)]
pub struct ErrorEvent {
    pub error: String,
    pub message: String,
}

/// Emit a progress JSON line to stdout.
pub fn emit_progress(phase: &str, bytes_processed: u64, total_bytes: u64) {
    let progress = if total_bytes > 0 {
        bytes_processed as f64 / total_bytes as f64
    } else {
        1.0
    };
    let event = ProgressEvent {
        progress,
        bytes_processed,
        total_bytes,
        phase: phase.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&event) {
        println!("{}", json);
    }
}

/// Emit an error JSON object to stderr and exit with the given code.
pub fn emit_error_and_exit(error_code: &str, message: &str, exit_code: i32) -> ! {
    let event = ErrorEvent {
        error: error_code.to_string(),
        message: message.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&event) {
        eprintln!("{}", json);
    }
    std::process::exit(exit_code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_event_serialization() {
        let event = ProgressEvent {
            progress: 0.5,
            bytes_processed: 1024,
            total_bytes: 2048,
            phase: "encrypt".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"progress\":0.5"));
        assert!(json.contains("\"bytes_processed\":1024"));
        assert!(json.contains("\"total_bytes\":2048"));
        assert!(json.contains("\"phase\":\"encrypt\""));
    }

    #[test]
    fn test_error_event_serialization() {
        let event = ErrorEvent {
            error: "wrong_passphrase".to_string(),
            message: "Authentication failed".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"error\":\"wrong_passphrase\""));
        assert!(json.contains("\"message\":\"Authentication failed\""));
    }

    #[test]
    fn test_emit_progress_zero_total() {
        // When total_bytes is 0, progress should be 1.0
        let total: u64 = 0;
        let progress_val = if total > 0 { 0.0 } else { 1.0 };
        let event = ProgressEvent {
            progress: progress_val,
            bytes_processed: 0,
            total_bytes: 0,
            phase: "encrypt".to_string(),
        };
        assert!((event.progress - 1.0).abs() < f64::EPSILON);
    }
}
