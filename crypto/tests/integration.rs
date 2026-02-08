use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};

/// Get the path to the compiled binary.
/// cargo test builds in debug mode by default.
fn binary_path() -> std::path::PathBuf {
    let mut path = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    path.push("gtkrypt-crypto");
    path
}

/// Run the gtkrypt-crypto binary with the given args and passphrase on stdin.
fn run_crypto(args: &[&str], passphrase: &str) -> std::process::Output {
    let bin = binary_path();
    let mut child = Command::new(&bin)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| panic!("Failed to spawn {:?}: {}", bin, e));

    // Write passphrase to stdin and close it
    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(stdin, "{}", passphrase).unwrap();
    }

    child.wait_with_output().unwrap()
}

#[test]
fn test_roundtrip_encrypt_decrypt_small_file() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("hello.txt");
    let encrypted_path = dir.path().join("hello.txt.gtkrypt");
    let decrypted_path = dir.path().join("hello_decrypted.txt");

    let original_content = b"Hello, World! This is a roundtrip test for gtkrypt.";
    fs::write(&input_path, original_content).unwrap();

    // Encrypt with fast KDF params for testing
    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "my_secret_passphrase",
    );

    assert_eq!(
        output.status.code(),
        Some(0),
        "Encrypt failed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(encrypted_path.exists(), "Encrypted file should exist");

    // Verify encrypted file starts with magic bytes
    let encrypted_data = fs::read(&encrypted_path).unwrap();
    assert_eq!(&encrypted_data[0..8], b"GTKRYPT\0");

    // Decrypt
    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "my_secret_passphrase",
    );

    assert_eq!(
        output.status.code(),
        Some(0),
        "Decrypt failed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(decrypted_path.exists(), "Decrypted file should exist");

    // Verify content matches
    let decrypted_content = fs::read(&decrypted_path).unwrap();
    assert_eq!(
        decrypted_content, original_content,
        "Decrypted content should match original"
    );
}

#[test]
fn test_roundtrip_binary_data() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("binary_data.bin");
    let encrypted_path = dir.path().join("binary_data.bin.gtkrypt");
    let decrypted_path = dir.path().join("binary_data_decrypted.bin");

    // Create binary content with all byte values
    let mut original_content = Vec::with_capacity(256 * 4);
    for _ in 0..4 {
        for b in 0..=255u8 {
            original_content.push(b);
        }
    }
    fs::write(&input_path, &original_content).unwrap();

    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "binary_test_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "binary_test_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let decrypted_content = fs::read(&decrypted_path).unwrap();
    assert_eq!(decrypted_content, original_content);
}

#[test]
fn test_wrong_passphrase_fails_with_exit_code_1() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("secret.txt");
    let encrypted_path = dir.path().join("secret.txt.gtkrypt");
    let decrypted_path = dir.path().join("secret_decrypted.txt");

    fs::write(&input_path, b"Top secret data").unwrap();

    // Encrypt
    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "correct_password",
    );
    assert_eq!(output.status.code(), Some(0));

    // Decrypt with wrong passphrase
    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "wrong_password",
    );

    assert_eq!(
        output.status.code(),
        Some(1),
        "Should exit with code 1 for wrong passphrase"
    );

    // Decrypted file should NOT exist (fail closed)
    assert!(
        !decrypted_path.exists(),
        "No output file should be created on wrong passphrase"
    );

    // Stderr should contain error JSON
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("wrong_passphrase"),
        "stderr should contain error type: {}",
        stderr
    );
}

#[test]
fn test_corrupt_file_fails_with_exit_code_2() {
    let dir = tempfile::tempdir().unwrap();
    let corrupt_path = dir.path().join("corrupt.gtkrypt");
    let decrypted_path = dir.path().join("decrypted.txt");

    // Write some garbage that is not a valid gtkrypt file
    fs::write(&corrupt_path, b"This is not a gtkrypt file at all").unwrap();

    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            corrupt_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "any_password",
    );

    assert_eq!(
        output.status.code(),
        Some(2),
        "Should exit with code 2 for corrupt file"
    );

    assert!(
        !decrypted_path.exists(),
        "No output file should be created for corrupt input"
    );
}

#[test]
fn test_roundtrip_empty_file() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("empty.txt");
    let encrypted_path = dir.path().join("empty.txt.gtkrypt");
    let decrypted_path = dir.path().join("empty_decrypted.txt");

    fs::write(&input_path, b"").unwrap();

    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "empty_test_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "empty_test_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let decrypted = fs::read(&decrypted_path).unwrap();
    assert!(decrypted.is_empty(), "Decrypted empty file should be empty");
}

#[test]
fn test_encrypt_with_store_filename_flag() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("document.pdf");
    let encrypted_path = dir.path().join("document.pdf.gtkrypt");
    let decrypted_path = dir.path().join("document_decrypted.pdf");

    fs::write(&input_path, b"Fake PDF content").unwrap();

    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
            "--store-filename",
        ],
        "filename_test_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    // Decrypt and verify content is correct
    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "filename_test_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let decrypted = fs::read(&decrypted_path).unwrap();
    assert_eq!(decrypted, b"Fake PDF content");
}

#[test]
fn test_progress_output_on_stdout() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("progress_test.txt");
    let encrypted_path = dir.path().join("progress_test.gtkrypt");

    fs::write(&input_path, b"Some data for progress test").unwrap();

    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "progress_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Should contain JSON progress lines
    assert!(
        stdout.contains("\"phase\""),
        "stdout should contain progress JSON lines: {}",
        stdout
    );
    assert!(
        stdout.contains("\"kdf\""),
        "should report kdf phase: {}",
        stdout
    );
    assert!(
        stdout.contains("\"encrypt\""),
        "should report encrypt phase: {}",
        stdout
    );
}

#[test]
fn test_tampered_header_detected_by_gcm() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("tamper_test.txt");
    let encrypted_path = dir.path().join("tamper_test.gtkrypt");
    let tampered_path = dir.path().join("tampered.gtkrypt");
    let decrypted_path = dir.path().join("tamper_decrypted.txt");

    fs::write(&input_path, b"Data to test header tampering").unwrap();

    // Encrypt
    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "tamper_test_pass",
    );
    assert_eq!(output.status.code(), Some(0));

    // Tamper with a header byte in the AAD region.
    // We flip a nonce byte (offset 37-48) which is in the AAD but does NOT
    // affect KDF computation time, so the test runs quickly.
    let mut data = fs::read(&encrypted_path).unwrap();
    data[40] ^= 0xFF; // Flip a byte in the nonce field (within AAD)
    fs::write(&tampered_path, &data).unwrap();

    // Attempt to decrypt the tampered file
    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            tampered_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "tamper_test_pass",
    );

    // GCM should detect the tampered nonce/AAD and fail.
    // The nonce mismatch causes GCM authentication to fail.
    assert_ne!(
        output.status.code(),
        Some(0),
        "Tampered header should cause decryption to fail"
    );

    assert!(
        !decrypted_path.exists(),
        "No output file should be created for tampered input"
    );
}

#[test]
fn test_roundtrip_multi_chunk_large_file() {
    // Create a 1 MB file made of a repeated pattern to exercise multi-chunk
    // streaming (1 MB = ~16 chunks of 64 KiB).
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("large_file.bin");
    let encrypted_path = dir.path().join("large_file.bin.gtkrypt");
    let decrypted_path = dir.path().join("large_file_decrypted.bin");

    let one_mb = 1024 * 1024;
    let original_content: Vec<u8> = (0..=255u8).cycle().take(one_mb).collect();
    fs::write(&input_path, &original_content).unwrap();

    // Encrypt
    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "large_file_pass",
    );

    assert_eq!(
        output.status.code(),
        Some(0),
        "Encrypt of large file failed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    // The encrypted file should be larger than the original due to
    // header + per-chunk tags. With 16 chunks, that is 16 * 16 = 256 extra
    // tag bytes + 67 header bytes.
    let encrypted_size = fs::metadata(&encrypted_path).unwrap().len();
    assert!(
        encrypted_size > one_mb as u64,
        "Encrypted file should be larger than original"
    );

    // Decrypt
    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "large_file_pass",
    );

    assert_eq!(
        output.status.code(),
        Some(0),
        "Decrypt of large file failed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    // Verify byte-for-byte match
    let decrypted_content = fs::read(&decrypted_path).unwrap();
    assert_eq!(
        decrypted_content.len(),
        original_content.len(),
        "Decrypted file size should match original"
    );
    assert_eq!(
        decrypted_content, original_content,
        "Decrypted content should match original byte-for-byte"
    );
}

#[test]
fn test_roundtrip_exact_chunk_boundary() {
    // File size is exactly 64 KiB (one full chunk, no partial final chunk)
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("exact_chunk.bin");
    let encrypted_path = dir.path().join("exact_chunk.bin.gtkrypt");
    let decrypted_path = dir.path().join("exact_chunk_decrypted.bin");

    let chunk_size = 65536;
    let original_content: Vec<u8> = vec![0xCD; chunk_size];
    fs::write(&input_path, &original_content).unwrap();

    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "exact_chunk_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            encrypted_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "exact_chunk_pass",
    );

    assert_eq!(output.status.code(), Some(0));

    let decrypted_content = fs::read(&decrypted_path).unwrap();
    assert_eq!(decrypted_content, original_content);
}

#[test]
fn test_trailing_data_rejected_with_exit_code_2() {
    let dir = tempfile::tempdir().unwrap();
    let input_path = dir.path().join("trailing.txt");
    let encrypted_path = dir.path().join("trailing.txt.gtkrypt");
    let tampered_path = dir.path().join("trailing_extra.gtkrypt");
    let decrypted_path = dir.path().join("trailing_decrypted.txt");

    fs::write(&input_path, b"Data to test trailing bytes").unwrap();

    // Encrypt
    let output = run_crypto(
        &[
            "encrypt",
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            encrypted_path.to_str().unwrap(),
            "--time-cost",
            "1",
            "--memory-cost",
            "1024",
            "--parallelism",
            "1",
        ],
        "trailing_test_pass",
    );
    assert_eq!(output.status.code(), Some(0));

    // Append junk bytes to the encrypted file
    let mut data = fs::read(&encrypted_path).unwrap();
    data.extend_from_slice(b"JUNK_TRAILING_DATA");
    fs::write(&tampered_path, &data).unwrap();

    // Attempt to decrypt — should fail with exit code 2 (corrupt file)
    let output = run_crypto(
        &[
            "decrypt",
            "--input",
            tampered_path.to_str().unwrap(),
            "--output",
            decrypted_path.to_str().unwrap(),
        ],
        "trailing_test_pass",
    );

    assert_eq!(
        output.status.code(),
        Some(2),
        "Should exit with code 2 for file with trailing data. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(
        !decrypted_path.exists(),
        "No output file should be created for file with trailing data"
    );
}
