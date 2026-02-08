mod decrypt;
mod encrypt;
mod header;
mod kdf;
mod progress;

use std::io::BufRead;

use clap::{Parser, Subcommand};

use decrypt::DecryptError;
use encrypt::EncryptError;

/// gtkrypt-crypto: AES-256-GCM encryption/decryption backend for gtkrypt.
///
/// Reads passphrase from stdin (one line), performs the requested operation,
/// and reports progress as JSON lines on stdout and errors as JSON on stderr.
#[derive(Parser)]
#[command(name = "gtkrypt-crypto")]
#[command(about = "AES-256-GCM encryption/decryption backend for gtkrypt")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Encrypt a file
    Encrypt {
        /// Path to the input (plaintext) file
        #[arg(long)]
        input: String,

        /// Path to the output (encrypted) file
        #[arg(long)]
        output: String,

        /// Argon2id time cost parameter
        #[arg(long, default_value_t = 3)]
        time_cost: u32,

        /// Argon2id memory cost in KiB
        #[arg(long, default_value_t = 65536)]
        memory_cost: u32,

        /// Argon2id parallelism parameter
        #[arg(long, default_value_t = 4)]
        parallelism: u32,

        /// Store the original filename in the container header
        #[arg(long, default_value_t = false)]
        store_filename: bool,
    },

    /// Decrypt a file
    Decrypt {
        /// Path to the input (encrypted) file
        #[arg(long)]
        input: String,

        /// Path to the output (decrypted) file
        #[arg(long)]
        output: String,
    },
}

/// Read a single line passphrase from stdin.
fn read_passphrase() -> Result<String, String> {
    let stdin = std::io::stdin();
    let mut line = String::new();
    let mut handle = stdin.lock();

    handle
        .read_line(&mut line)
        .map_err(|e| format!("Failed to read passphrase from stdin: {}", e))?;

    // Remove trailing newline
    if line.ends_with('\n') {
        line.pop();
        if line.ends_with('\r') {
            line.pop();
        }
    }

    if line.is_empty() {
        return Err("Passphrase is empty".to_string());
    }

    Ok(line)
}

fn main() {
    let cli = Cli::parse();

    // Read passphrase from stdin
    let passphrase = match read_passphrase() {
        Ok(p) => p,
        Err(msg) => {
            progress::emit_error_and_exit("internal_error", &msg, 10);
        }
    };

    match cli.command {
        Commands::Encrypt {
            input,
            output,
            time_cost,
            memory_cost,
            parallelism,
            store_filename,
        } => {
            let opts = encrypt::EncryptOptions {
                input_path: input,
                output_path: output,
                passphrase,
                time_cost,
                memory_cost_kib: memory_cost,
                parallelism,
                store_filename,
            };

            match encrypt::encrypt(&opts) {
                Ok(()) => {
                    std::process::exit(0);
                }
                Err(EncryptError::Permission(msg)) => {
                    progress::emit_error_and_exit("permission_error", &msg, 3);
                }
                Err(EncryptError::Internal(msg)) => {
                    progress::emit_error_and_exit("internal_error", &msg, 10);
                }
            }
        }

        Commands::Decrypt { input, output } => {
            let opts = decrypt::DecryptOptions {
                input_path: input,
                output_path: output,
                passphrase,
            };

            match decrypt::decrypt(&opts) {
                Ok(()) => {
                    std::process::exit(0);
                }
                Err(DecryptError::WrongPassphrase(msg)) => {
                    progress::emit_error_and_exit("wrong_passphrase", &msg, 1);
                }
                Err(DecryptError::CorruptFile(msg)) => {
                    progress::emit_error_and_exit("corrupt_file", &msg, 2);
                }
                Err(DecryptError::Permission(msg)) => {
                    progress::emit_error_and_exit("permission_error", &msg, 3);
                }
                Err(DecryptError::Internal(msg)) => {
                    progress::emit_error_and_exit("internal_error", &msg, 10);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn test_passphrase_trimming() {
        // Simulate what read_passphrase does with trailing newline
        let mut line = "my_passphrase\n".to_string();
        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        }
        assert_eq!(line, "my_passphrase");
    }

    #[test]
    fn test_passphrase_crlf_trimming() {
        let mut line = "my_passphrase\r\n".to_string();
        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        }
        assert_eq!(line, "my_passphrase");
    }
}
