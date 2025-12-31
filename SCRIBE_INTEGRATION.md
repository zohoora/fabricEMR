# Scribe App Integration Guide

This document describes how to integrate an AI scribe application with the FabricEMR Medplum server for clinician authentication and clinical data storage.

## Overview

The scribe app will:
1. Authenticate clinicians via OAuth 2.0 (24-hour sessions)
2. Create encounters with scribe-generated UUIDs
3. Upload transcriptions, SOAP notes, audio recordings, and session metadata
4. Retrieve encounters by ID or practitioner + date range

**Important**: Practitioners can only access their own encounter data.

---

## Configuration

The scribe app should have a configurable base URL for the Medplum server:

```toml
# Example config.toml
[medplum]
base_url = "http://localhost:8103"
client_id = "your-scribe-app-client-id"
redirect_uri = "fabricscribe://oauth/callback"
```

---

## 1. Authentication

### 1.1 Register the Scribe App as a Client

Before the scribe app can authenticate users, register it in Medplum:

1. Log into Medplum App (`http://{MEDPLUM_BASE_URL}:3000`)
2. Navigate to **Admin** → **Project** → **Client Applications**
3. Create a new Client Application:
   - **Name**: `FabricScribe`
   - **Redirect URI**: `fabricscribe://oauth/callback` (custom URI scheme for Tauri)
   - **Access Policy**: Create or assign a policy that restricts to own data (see Section 6)

Save the **Client ID** - you'll need this in the scribe app.

### 1.2 OAuth 2.0 Authorization Code Flow with PKCE

Since this is a desktop app, use **PKCE** (Proof Key for Code Exchange) for security.

#### Endpoints

| Endpoint | URL |
|----------|-----|
| Authorization | `{MEDPLUM_BASE_URL}/oauth2/authorize` |
| Token | `{MEDPLUM_BASE_URL}/oauth2/token` |
| UserInfo | `{MEDPLUM_BASE_URL}/oauth2/userinfo` |

#### Flow

```
┌─────────────────┐                              ┌─────────────────┐
│   Scribe App    │                              │     Medplum     │
└────────┬────────┘                              └────────┬────────┘
         │                                                │
         │ 1. Generate code_verifier + code_challenge     │
         │                                                │
         │ 2. Open browser to /oauth2/authorize           │
         │    ?response_type=code                         │
         │    &client_id={CLIENT_ID}                      │
         │    &redirect_uri=fabricscribe://oauth/callback │
         │    &scope=openid profile                       │
         │    &code_challenge={CHALLENGE}                 │
         │    &code_challenge_method=S256                 │
         │ ──────────────────────────────────────────────►│
         │                                                │
         │                      3. User logs in           │
         │                                                │
         │ 4. Redirect to fabricscribe://oauth/callback   │
         │    ?code={AUTH_CODE}                           │
         │ ◄──────────────────────────────────────────────│
         │                                                │
         │ 5. POST /oauth2/token                          │
         │    grant_type=authorization_code               │
         │    &code={AUTH_CODE}                           │
         │    &client_id={CLIENT_ID}                      │
         │    &redirect_uri={REDIRECT_URI}                │
         │    &code_verifier={VERIFIER}                   │
         │ ──────────────────────────────────────────────►│
         │                                                │
         │ 6. Token Response                              │
         │    { access_token, refresh_token, expires_in } │
         │ ◄──────────────────────────────────────────────│
```

#### Rust Implementation

```rust
use oauth2::{
    AuthorizationCode, AuthUrl, ClientId, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenUrl,
    basic::BasicClient,
};
use reqwest;

pub struct MedplumAuth {
    client: BasicClient,
    base_url: String,
}

impl MedplumAuth {
    pub fn new(base_url: &str, client_id: &str, redirect_uri: &str) -> Self {
        let client = BasicClient::new(
            ClientId::new(client_id.to_string()),
            None, // No client secret for public clients
            AuthUrl::new(format!("{}/oauth2/authorize", base_url)).unwrap(),
            Some(TokenUrl::new(format!("{}/oauth2/token", base_url)).unwrap()),
        )
        .set_redirect_uri(RedirectUrl::new(redirect_uri.to_string()).unwrap());

        Self {
            client,
            base_url: base_url.to_string(),
        }
    }

    /// Generate authorization URL and PKCE verifier
    pub fn start_auth(&self) -> (String, PkceCodeVerifier, CsrfToken) {
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let (auth_url, csrf_token) = self.client
            .authorize_url(CsrfToken::new_random)
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .set_pkce_challenge(pkce_challenge)
            .url();

        (auth_url.to_string(), pkce_verifier, csrf_token)
    }

    /// Exchange authorization code for tokens
    pub async fn exchange_code(
        &self,
        code: &str,
        pkce_verifier: PkceCodeVerifier,
    ) -> Result<TokenResponse, AuthError> {
        let token_result = self.client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .set_pkce_verifier(pkce_verifier)
            .request_async(oauth2::reqwest::async_http_client)
            .await?;

        Ok(TokenResponse {
            access_token: token_result.access_token().secret().clone(),
            refresh_token: token_result.refresh_token().map(|t| t.secret().clone()),
            expires_in: token_result.expires_in().map(|d| d.as_secs()),
        })
    }
}

#[derive(Debug, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
}
```

### 1.3 Token Storage & Refresh

- Store tokens securely (use Tauri's secure storage or OS keychain)
- Tokens expire in 24 hours
- Use refresh token to obtain new access token before expiry

```rust
pub async fn refresh_access_token(
    base_url: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse, reqwest::Error> {
    let client = reqwest::Client::new();

    let response = client
        .post(&format!("{}/oauth2/token", base_url))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await?
        .json::<TokenResponse>()
        .await?;

    Ok(response)
}
```

### 1.4 Get Current Practitioner

After authentication, fetch the logged-in practitioner's info:

```rust
pub async fn get_current_user(
    base_url: &str,
    access_token: &str,
) -> Result<Practitioner, reqwest::Error> {
    let client = reqwest::Client::new();

    // Get user info which includes the Practitioner reference
    let userinfo: UserInfo = client
        .get(&format!("{}/oauth2/userinfo", base_url))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    // Fetch the Practitioner resource
    let practitioner: Practitioner = client
        .get(&format!("{}/fhir/R4/{}", base_url, userinfo.profile))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    Ok(practitioner)
}
```

---

## 2. Creating an Encounter

The scribe app generates a UUID for each encounter and creates the FHIR resources.

### 2.1 Encounter Structure

Each scribe session creates:
1. **Patient** - Placeholder with scribe-generated ID (no real patient data)
2. **Encounter** - Links practitioner to patient and session
3. **DocumentReference** - For SOAP notes and transcriptions
4. **Media** - For audio recordings
5. **DocumentReference** - For session metadata file

### 2.2 Generate Encounter ID

```rust
use uuid::Uuid;

pub fn generate_encounter_id() -> String {
    Uuid::new_v4().to_string()
}
```

### 2.3 Create Placeholder Patient

```rust
pub async fn create_placeholder_patient(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();

    let patient = serde_json::json!({
        "resourceType": "Patient",
        "identifier": [{
            "system": "urn:fabricscribe:encounter",
            "value": encounter_id
        }],
        "active": false,
        "meta": {
            "tag": [{
                "system": "urn:fabricscribe",
                "code": "scribe-session"
            }]
        }
    });

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/Patient", base_url))
        .bearer_auth(access_token)
        .json(&patient)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

### 2.4 Create Encounter Resource

```rust
pub async fn create_encounter(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
    patient_id: &str,
    practitioner_id: &str,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();

    let encounter = serde_json::json!({
        "resourceType": "Encounter",
        "identifier": [{
            "system": "urn:fabricscribe:encounter",
            "value": encounter_id
        }],
        "status": "in-progress",
        "class": {
            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code": "AMB",
            "display": "ambulatory"
        },
        "subject": {
            "reference": format!("Patient/{}", patient_id)
        },
        "participant": [{
            "type": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                    "code": "PPRF",
                    "display": "primary performer"
                }]
            }],
            "individual": {
                "reference": format!("Practitioner/{}", practitioner_id)
            }
        }],
        "period": {
            "start": chrono::Utc::now().to_rfc3339()
        },
        "meta": {
            "tag": [{
                "system": "urn:fabricscribe",
                "code": "scribe-session"
            }]
        }
    });

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/Encounter", base_url))
        .bearer_auth(access_token)
        .json(&encounter)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

---

## 3. Uploading Data

### 3.1 Upload Transcription

```rust
pub async fn upload_transcription(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
    encounter_fhir_id: &str,
    patient_id: &str,
    transcription_text: &str,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();

    let doc_ref = serde_json::json!({
        "resourceType": "DocumentReference",
        "identifier": [{
            "system": "urn:fabricscribe:encounter",
            "value": encounter_id
        }],
        "status": "current",
        "type": {
            "coding": [{
                "system": "http://loinc.org",
                "code": "75476-2",
                "display": "Transcript"
            }]
        },
        "category": [{
            "coding": [{
                "system": "urn:fabricscribe",
                "code": "transcription"
            }]
        }],
        "subject": {
            "reference": format!("Patient/{}", patient_id)
        },
        "context": {
            "encounter": [{
                "reference": format!("Encounter/{}", encounter_fhir_id)
            }]
        },
        "content": [{
            "attachment": {
                "contentType": "text/plain",
                "data": base64::encode(transcription_text)
            }
        }],
        "date": chrono::Utc::now().to_rfc3339()
    });

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/DocumentReference", base_url))
        .bearer_auth(access_token)
        .json(&doc_ref)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

### 3.2 Upload SOAP Note

```rust
pub async fn upload_soap_note(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
    encounter_fhir_id: &str,
    patient_id: &str,
    soap_note_text: &str,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();

    let doc_ref = serde_json::json!({
        "resourceType": "DocumentReference",
        "identifier": [{
            "system": "urn:fabricscribe:encounter",
            "value": encounter_id
        }],
        "status": "current",
        "type": {
            "coding": [{
                "system": "http://loinc.org",
                "code": "11506-3",
                "display": "Progress note"
            }]
        },
        "category": [{
            "coding": [{
                "system": "urn:fabricscribe",
                "code": "soap-note"
            }]
        }],
        "subject": {
            "reference": format!("Patient/{}", patient_id)
        },
        "context": {
            "encounter": [{
                "reference": format!("Encounter/{}", encounter_fhir_id)
            }]
        },
        "content": [{
            "attachment": {
                "contentType": "text/plain",
                "data": base64::encode(soap_note_text)
            }
        }],
        "date": chrono::Utc::now().to_rfc3339()
    });

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/DocumentReference", base_url))
        .bearer_auth(access_token)
        .json(&doc_ref)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

### 3.3 Upload Session Info

```rust
pub async fn upload_session_info(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
    encounter_fhir_id: &str,
    patient_id: &str,
    session_info_json: &str,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();

    let doc_ref = serde_json::json!({
        "resourceType": "DocumentReference",
        "identifier": [{
            "system": "urn:fabricscribe:encounter",
            "value": encounter_id
        }],
        "status": "current",
        "type": {
            "coding": [{
                "system": "urn:fabricscribe",
                "code": "session-metadata",
                "display": "Session Metadata"
            }]
        },
        "category": [{
            "coding": [{
                "system": "urn:fabricscribe",
                "code": "session-info"
            }]
        }],
        "subject": {
            "reference": format!("Patient/{}", patient_id)
        },
        "context": {
            "encounter": [{
                "reference": format!("Encounter/{}", encounter_fhir_id)
            }]
        },
        "content": [{
            "attachment": {
                "contentType": "application/json",
                "data": base64::encode(session_info_json)
            }
        }],
        "date": chrono::Utc::now().to_rfc3339()
    });

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/DocumentReference", base_url))
        .bearer_auth(access_token)
        .json(&doc_ref)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

### 3.4 Upload Audio (Chunked)

For large audio files, upload in chunks using Medplum's Binary resource with chunked transfer.

#### Step 1: Upload Binary (chunked)

```rust
use tokio::io::AsyncReadExt;
use tokio::fs::File;

pub async fn upload_audio_chunked(
    base_url: &str,
    access_token: &str,
    file_path: &str,
    content_type: &str, // e.g., "audio/wav", "audio/webm"
) -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    // Read file
    let mut file = File::open(file_path).await?;
    let metadata = file.metadata().await?;
    let file_size = metadata.len();

    // For files > 10MB, use chunked upload
    const CHUNK_SIZE: u64 = 5 * 1024 * 1024; // 5MB chunks

    if file_size <= CHUNK_SIZE {
        // Small file: upload directly
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).await?;

        let response: serde_json::Value = client
            .post(&format!("{}/fhir/R4/Binary", base_url))
            .bearer_auth(access_token)
            .header("Content-Type", content_type)
            .body(buffer)
            .send()
            .await?
            .json()
            .await?;

        return Ok(response["id"].as_str().unwrap().to_string());
    }

    // Large file: upload in chunks using streaming
    let file = File::open(file_path).await?;
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = reqwest::Body::wrap_stream(stream);

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/Binary", base_url))
        .bearer_auth(access_token)
        .header("Content-Type", content_type)
        .header("Content-Length", file_size.to_string())
        .body(body)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

#### Step 2: Create Media Resource Linking to Binary

```rust
pub async fn create_media_resource(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
    encounter_fhir_id: &str,
    patient_id: &str,
    binary_id: &str,
    content_type: &str,
    duration_seconds: Option<u64>,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();

    let mut media = serde_json::json!({
        "resourceType": "Media",
        "identifier": [{
            "system": "urn:fabricscribe:encounter",
            "value": encounter_id
        }],
        "status": "completed",
        "type": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/media-type",
                "code": "audio",
                "display": "Audio"
            }]
        },
        "subject": {
            "reference": format!("Patient/{}", patient_id)
        },
        "encounter": {
            "reference": format!("Encounter/{}", encounter_fhir_id)
        },
        "content": {
            "contentType": content_type,
            "url": format!("Binary/{}", binary_id)
        },
        "meta": {
            "tag": [{
                "system": "urn:fabricscribe",
                "code": "scribe-session"
            }]
        }
    });

    if let Some(duration) = duration_seconds {
        media["duration"] = serde_json::json!(duration);
    }

    let response: serde_json::Value = client
        .post(&format!("{}/fhir/R4/Media", base_url))
        .bearer_auth(access_token)
        .json(&media)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["id"].as_str().unwrap().to_string())
}
```

#### Combined Upload Function

```rust
pub async fn upload_audio_recording(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
    encounter_fhir_id: &str,
    patient_id: &str,
    file_path: &str,
    content_type: &str,
    duration_seconds: Option<u64>,
) -> Result<String, Box<dyn std::error::Error>> {
    // Step 1: Upload the binary audio data
    let binary_id = upload_audio_chunked(
        base_url,
        access_token,
        file_path,
        content_type,
    ).await?;

    // Step 2: Create Media resource linking to the binary
    let media_id = create_media_resource(
        base_url,
        access_token,
        encounter_id,
        encounter_fhir_id,
        patient_id,
        &binary_id,
        content_type,
        duration_seconds,
    ).await?;

    Ok(media_id)
}
```

---

## 4. Retrieving Data

### 4.1 Get Encounter by ID

```rust
pub async fn get_encounter_by_id(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
) -> Result<Encounter, reqwest::Error> {
    let client = reqwest::Client::new();

    // Search by our custom identifier
    let response: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/Encounter?identifier=urn:fabricscribe:encounter|{}",
            base_url, encounter_id
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    // Parse the Bundle and extract the Encounter
    // Returns the first matching encounter
    Ok(parse_encounter_from_bundle(response))
}
```

### 4.2 Get All Data for an Encounter

```rust
#[derive(Debug)]
pub struct EncounterData {
    pub encounter: serde_json::Value,
    pub soap_note: Option<String>,
    pub transcription: Option<String>,
    pub session_info: Option<String>,
    pub audio_url: Option<String>,
}

pub async fn get_encounter_data(
    base_url: &str,
    access_token: &str,
    encounter_id: &str,
) -> Result<EncounterData, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    // Fetch all resources with this encounter identifier
    let encounter_bundle: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/Encounter?identifier=urn:fabricscribe:encounter|{}&_include=*",
            base_url, encounter_id
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    // Fetch DocumentReferences
    let docs_bundle: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/DocumentReference?identifier=urn:fabricscribe:encounter|{}",
            base_url, encounter_id
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    // Fetch Media
    let media_bundle: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/Media?identifier=urn:fabricscribe:encounter|{}",
            base_url, encounter_id
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    // Parse and assemble the data
    let mut data = EncounterData {
        encounter: extract_first_entry(&encounter_bundle),
        soap_note: None,
        transcription: None,
        session_info: None,
        audio_url: None,
    };

    // Extract documents by category
    if let Some(entries) = docs_bundle["entry"].as_array() {
        for entry in entries {
            let resource = &entry["resource"];
            let category = resource["category"][0]["coding"][0]["code"]
                .as_str()
                .unwrap_or("");

            let content_data = resource["content"][0]["attachment"]["data"]
                .as_str()
                .map(|d| String::from_utf8(base64::decode(d).unwrap()).unwrap());

            match category {
                "soap-note" => data.soap_note = content_data,
                "transcription" => data.transcription = content_data,
                "session-info" => data.session_info = content_data,
                _ => {}
            }
        }
    }

    // Extract audio URL
    if let Some(entries) = media_bundle["entry"].as_array() {
        if let Some(first) = entries.first() {
            data.audio_url = first["resource"]["content"]["url"]
                .as_str()
                .map(|s| format!("{}/fhir/R4/{}", base_url, s));
        }
    }

    Ok(data)
}
```

### 4.3 List Encounters by Practitioner and Date Range

```rust
pub async fn list_encounters_by_date_range(
    base_url: &str,
    access_token: &str,
    practitioner_id: &str,
    start_date: &str, // ISO format: 2024-12-01
    end_date: &str,   // ISO format: 2024-12-31
) -> Result<Vec<EncounterSummary>, reqwest::Error> {
    let client = reqwest::Client::new();

    let response: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/Encounter\
            ?participant=Practitioner/{}\
            &date=ge{}\
            &date=le{}\
            &_tag=urn:fabricscribe|scribe-session\
            &_sort=-date\
            &_count=100",
            base_url, practitioner_id, start_date, end_date
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    let mut encounters = Vec::new();

    if let Some(entries) = response["entry"].as_array() {
        for entry in entries {
            let resource = &entry["resource"];
            encounters.push(EncounterSummary {
                fhir_id: resource["id"].as_str().unwrap_or("").to_string(),
                encounter_id: resource["identifier"][0]["value"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                status: resource["status"].as_str().unwrap_or("").to_string(),
                start_time: resource["period"]["start"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }

    Ok(encounters)
}

#[derive(Debug)]
pub struct EncounterSummary {
    pub fhir_id: String,
    pub encounter_id: String,
    pub status: String,
    pub start_time: String,
}
```

### 4.4 Download Audio File

```rust
pub async fn download_audio(
    base_url: &str,
    access_token: &str,
    binary_id: &str,
    output_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let response = client
        .get(&format!("{}/fhir/R4/Binary/{}", base_url, binary_id))
        .bearer_auth(access_token)
        .send()
        .await?;

    let bytes = response.bytes().await?;
    tokio::fs::write(output_path, bytes).await?;

    Ok(())
}
```

---

## 5. Completing an Encounter

When the scribe session ends, update the encounter status:

```rust
pub async fn complete_encounter(
    base_url: &str,
    access_token: &str,
    encounter_fhir_id: &str,
) -> Result<(), reqwest::Error> {
    let client = reqwest::Client::new();

    // Get current encounter
    let mut encounter: serde_json::Value = client
        .get(&format!("{}/fhir/R4/Encounter/{}", base_url, encounter_fhir_id))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    // Update status and end time
    encounter["status"] = serde_json::json!("finished");
    encounter["period"]["end"] = serde_json::json!(chrono::Utc::now().to_rfc3339());

    // PUT the updated encounter
    client
        .put(&format!("{}/fhir/R4/Encounter/{}", base_url, encounter_fhir_id))
        .bearer_auth(access_token)
        .json(&encounter)
        .send()
        .await?;

    Ok(())
}
```

---

## 6. Access Control Setup

To ensure practitioners can only see their own data, create an Access Policy in Medplum.

### Create Access Policy

In Medplum App, go to **Admin** → **Access Policies** → **Create**:

```json
{
  "resourceType": "AccessPolicy",
  "name": "Scribe App - Own Data Only",
  "resource": [
    {
      "resourceType": "Patient",
      "criteria": "Patient?_tag=urn:fabricscribe|scribe-session"
    },
    {
      "resourceType": "Encounter",
      "criteria": "Encounter?participant=%user.reference"
    },
    {
      "resourceType": "DocumentReference",
      "criteria": "DocumentReference?context:encounter.participant=%user.reference"
    },
    {
      "resourceType": "Media",
      "criteria": "Media?encounter.participant=%user.reference"
    },
    {
      "resourceType": "Binary"
    }
  ]
}
```

Assign this policy to the Scribe App client application.

---

## 7. Error Handling

### Common HTTP Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Unauthorized | Token expired; refresh or re-authenticate |
| 403 | Forbidden | User doesn't have access to this resource |
| 404 | Not Found | Resource doesn't exist |
| 422 | Unprocessable | Invalid FHIR resource; check payload |

### Rust Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum MedplumError {
    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[error("Token expired")]
    TokenExpired,

    #[error("Access denied to resource: {0}")]
    AccessDenied(String),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Invalid FHIR resource: {0}")]
    ValidationError(String),

    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
}

pub async fn handle_response<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, MedplumError> {
    match response.status() {
        reqwest::StatusCode::OK | reqwest::StatusCode::CREATED => {
            Ok(response.json().await?)
        }
        reqwest::StatusCode::UNAUTHORIZED => {
            Err(MedplumError::TokenExpired)
        }
        reqwest::StatusCode::FORBIDDEN => {
            let body = response.text().await.unwrap_or_default();
            Err(MedplumError::AccessDenied(body))
        }
        reqwest::StatusCode::NOT_FOUND => {
            Err(MedplumError::NotFound("Resource not found".into()))
        }
        reqwest::StatusCode::UNPROCESSABLE_ENTITY => {
            let body = response.text().await.unwrap_or_default();
            Err(MedplumError::ValidationError(body))
        }
        _ => {
            let body = response.text().await.unwrap_or_default();
            Err(MedplumError::AuthError(body))
        }
    }
}
```

---

## 8. Complete Example: Scribe Session Workflow

```rust
pub async fn run_scribe_session(
    config: &Config,
    access_token: &str,
    practitioner_id: &str,
    transcription: &str,
    soap_note: &str,
    audio_path: &str,
    session_info: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let base_url = &config.medplum.base_url;

    // 1. Generate encounter ID
    let encounter_id = generate_encounter_id();
    println!("Created encounter: {}", encounter_id);

    // 2. Create placeholder patient
    let patient_id = create_placeholder_patient(
        base_url, access_token, &encounter_id
    ).await?;

    // 3. Create encounter
    let encounter_fhir_id = create_encounter(
        base_url, access_token, &encounter_id, &patient_id, practitioner_id
    ).await?;

    // 4. Upload all data in parallel
    let (transcript_result, soap_result, audio_result, session_result) = tokio::join!(
        upload_transcription(
            base_url, access_token, &encounter_id,
            &encounter_fhir_id, &patient_id, transcription
        ),
        upload_soap_note(
            base_url, access_token, &encounter_id,
            &encounter_fhir_id, &patient_id, soap_note
        ),
        upload_audio_recording(
            base_url, access_token, &encounter_id,
            &encounter_fhir_id, &patient_id, audio_path,
            "audio/webm", None
        ),
        upload_session_info(
            base_url, access_token, &encounter_id,
            &encounter_fhir_id, &patient_id, session_info
        )
    );

    // Check results
    transcript_result?;
    soap_result?;
    audio_result?;
    session_result?;

    // 5. Mark encounter as complete
    complete_encounter(base_url, access_token, &encounter_fhir_id).await?;

    println!("Session complete. Encounter ID: {}", encounter_id);
    Ok(encounter_id)
}
```

---

## 9. Cargo Dependencies

Add these to your `Cargo.toml`:

```toml
[dependencies]
reqwest = { version = "0.11", features = ["json", "stream"] }
tokio = { version = "1", features = ["full"] }
tokio-util = { version = "0.7", features = ["io"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
oauth2 = "4"
uuid = { version = "1", features = ["v4"] }
base64 = "0.21"
chrono = { version = "0.4", features = ["serde"] }
thiserror = "1"
```

---

## 10. Testing

### Test Authentication

```bash
# Get authorization URL (implement in your app, or test manually)
open "http://localhost:8103/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=fabricscribe://oauth/callback&scope=openid%20profile&code_challenge=CHALLENGE&code_challenge_method=S256"
```

### Test FHIR API

```bash
# List encounters (with valid token)
curl -X GET "http://localhost:8103/fhir/R4/Encounter?_tag=urn:fabricscribe|scribe-session" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## 11. Querying DocumentReferences by Encounter

### CRITICAL: Use Server-Returned Encounter ID

When creating resources that reference an Encounter, you **MUST** use the ID returned by the server, not a pre-generated UUID.

#### Common Bug Pattern (WRONG)

```rust
// DON'T DO THIS - generates ID before server assigns one
let my_encounter_id = Uuid::new_v4().to_string();

let encounter = serde_json::json!({
    "resourceType": "Encounter",
    // ...
});

// Posts encounter, but server assigns DIFFERENT id
client.post("/fhir/R4/Encounter").json(&encounter).send().await?;

// WRONG: Using pre-generated ID instead of server-returned ID
let doc_ref = serde_json::json!({
    "context": {
        "encounter": [{
            "reference": format!("Encounter/{}", my_encounter_id)  // BUG!
        }]
    }
});
```

#### Correct Pattern

```rust
// Create encounter and capture server-returned ID
let response: serde_json::Value = client
    .post(&format!("{}/fhir/R4/Encounter", base_url))
    .bearer_auth(access_token)
    .json(&encounter)
    .send()
    .await?
    .json()
    .await?;

// Use the ID from the server response
let encounter_fhir_id = response["id"].as_str().unwrap();

// NOW use the correct ID for DocumentReference
let doc_ref = serde_json::json!({
    "context": {
        "encounter": [{
            "reference": format!("Encounter/{}", encounter_fhir_id)  // CORRECT!
        }]
    }
});
```

### Query DocumentReferences by Encounter

Once resources are correctly linked, query them using:

```bash
# Get DocumentReferences for a specific Encounter
GET /fhir/R4/DocumentReference?encounter=Encounter/{encounter_fhir_id}

# Example
curl -X GET "http://localhost:8103/fhir/R4/DocumentReference?encounter=Encounter/04c8e027-4ed0-4a69-a2a1-e1096c0031ff" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Query All Encounters with Their Documents

```bash
# List all Encounters with IDs and periods
GET /fhir/R4/Encounter?_tag=urn:fabricscribe|scribe-session&_sort=-date

# Get all DocumentReferences and see their encounter links
GET /fhir/R4/DocumentReference?_tag=urn:fabricscribe|scribe-session&_include=DocumentReference:encounter
```

### Rust Implementation

```rust
/// Get all DocumentReferences linked to an Encounter
pub async fn get_documents_for_encounter(
    base_url: &str,
    access_token: &str,
    encounter_fhir_id: &str,
) -> Result<Vec<serde_json::Value>, reqwest::Error> {
    let client = reqwest::Client::new();

    let response: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/DocumentReference?encounter=Encounter/{}",
            base_url, encounter_fhir_id
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    let mut documents = Vec::new();
    if let Some(entries) = response["entry"].as_array() {
        for entry in entries {
            documents.push(entry["resource"].clone());
        }
    }

    Ok(documents)
}

/// List all Encounters with their periods
pub async fn list_all_encounters(
    base_url: &str,
    access_token: &str,
) -> Result<Vec<EncounterInfo>, reqwest::Error> {
    let client = reqwest::Client::new();

    let response: serde_json::Value = client
        .get(&format!(
            "{}/fhir/R4/Encounter?_tag=urn:fabricscribe|scribe-session&_sort=-date&_count=100",
            base_url
        ))
        .bearer_auth(access_token)
        .send()
        .await?
        .json()
        .await?;

    let mut encounters = Vec::new();
    if let Some(entries) = response["entry"].as_array() {
        for entry in entries {
            let resource = &entry["resource"];
            encounters.push(EncounterInfo {
                id: resource["id"].as_str().unwrap_or("").to_string(),
                status: resource["status"].as_str().unwrap_or("").to_string(),
                period_start: resource["period"]["start"].as_str().map(String::from),
                period_end: resource["period"]["end"].as_str().map(String::from),
            });
        }
    }

    Ok(encounters)
}

#[derive(Debug)]
pub struct EncounterInfo {
    pub id: String,
    pub status: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}
```

---

## 12. Troubleshooting

### DocumentReference Query Returns 0 Results

**Symptom:** `GET /fhir/R4/DocumentReference?encounter=Encounter/{id}` returns empty bundle.

**Cause:** The DocumentReference's `context.encounter[0].reference` contains a different Encounter ID than what's actually in the database.

**Diagnosis:**
```bash
# Check what Encounter IDs exist
curl -X GET "http://localhost:8103/fhir/R4/Encounter?_summary=true" \
  -H "Authorization: Bearer TOKEN"

# Check what Encounter IDs are referenced in DocumentReferences
curl -X GET "http://localhost:8103/fhir/R4/DocumentReference?_elements=context" \
  -H "Authorization: Bearer TOKEN"
```

**Fix:** Ensure you use the server-returned Encounter ID (see Section 11).

### Access Policy Not Working

**Symptom:** Practitioners can see other practitioners' data.

**Check:** Verify the AccessPolicy uses `%user.reference` correctly:
```json
{
  "resourceType": "Encounter",
  "criteria": "Encounter?participant=%user.reference"
}
```

### Token Expired During Long Session

**Symptom:** 401 errors during uploads.

**Fix:** Implement proactive token refresh before expiry:
```rust
if token_expires_in < Duration::from_secs(300) {
    refresh_token().await?;
}
```

---

## Summary

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Authorize | `/oauth2/authorize` | GET (browser) |
| Token | `/oauth2/token` | POST |
| Create Patient | `/fhir/R4/Patient` | POST |
| Create Encounter | `/fhir/R4/Encounter` | POST |
| Upload Document | `/fhir/R4/DocumentReference` | POST |
| Upload Audio Binary | `/fhir/R4/Binary` | POST |
| Create Media | `/fhir/R4/Media` | POST |
| Get Encounter | `/fhir/R4/Encounter?identifier=...` | GET |
| **Get Docs by Encounter** | `/fhir/R4/DocumentReference?encounter=Encounter/{id}` | GET |
| List by Date | `/fhir/R4/Encounter?participant=...&date=...` | GET |
| Update Encounter | `/fhir/R4/Encounter/{id}` | PUT |

---

## Appendix: Current Client Registration

**Client ID:** `af1464aa-e00c-4940-a32e-18d878b7911c`
**Redirect URI:** `fabricscribe://oauth/callback`
**Access Policy:** `Scribe App - Own Data Only` (`b5f6ae4a-f6ee-4085-959a-a9780a51c0a3`)
