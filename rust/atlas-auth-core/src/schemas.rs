use crate::state::ChallengePresentation;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Clone, Debug, Deserialize)]
pub struct DesktopV3ApiEnvelope<T> {
    pub success: bool,
    pub data: Option<T>,
    pub code: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CapabilitiesV3Response {
    pub version: u8,
    pub enabled: bool,
    pub reason: Option<String>,
    pub methods: CapabilitiesV3Methods,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CapabilitiesV3Methods {
    pub password_otp: PasswordOtpMethodV3,
    pub mailbox_enrollment: SimpleCapabilityV3,
    pub recovery: SimpleCapabilityV3,
    pub device_proof: DeviceProofCapabilityV3,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PasswordOtpMethodV3 {
    pub available: bool,
    #[serde(default)]
    pub challenge_modes: Vec<ChallengePresentation>,
    #[serde(default)]
    pub automatic_fallback: bool,
    #[serde(default)]
    pub otp_required: bool,
    #[serde(default)]
    pub dpop_required: bool,
    #[serde(default)]
    pub verified_mailbox_required: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SimpleCapabilityV3 {
    pub available: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeviceProofCapabilityV3 {
    pub available: bool,
    #[serde(default)]
    pub hardware_attestation_claimed: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct NonceResponse {
    pub nonce: String,
    pub expires_in: u64,
}

#[derive(Clone, Serialize)]
pub struct CreateRequestV3Body<'a> {
    pub origin: &'a str,
    pub state: &'a str,
    pub code_challenge: &'a str,
    pub code_challenge_method: &'static str,
    pub device_label: &'a str,
    pub presentation: ChallengePresentation,
}

impl std::fmt::Debug for CreateRequestV3Body<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CreateRequestV3Body")
            .field("origin", &self.origin)
            .field("state", &"[REDACTED]")
            .field("code_challenge", &self.code_challenge)
            .field("code_challenge_method", &self.code_challenge_method)
            .field("device_label", &self.device_label)
            .field("presentation", &self.presentation)
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateRequestV3Response {
    pub version: u8,
    pub request_id: String,
    pub origin: String,
    pub presentation: ChallengePresentation,
    pub challenge_url: String,
    pub pairing_code: String,
    pub device_thumbprint: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChallengePollResponse {
    pub status: ChallengeVerifyStatus,
    pub request_id: String,
    pub origin: String,
    pub interval: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeVerifyStatus {
    Pending,
    Verifying,
    Verified,
    Denied,
    Failed,
    Cancelled,
    Consumed,
}

#[derive(Clone, Serialize, Zeroize, ZeroizeOnDrop)]
pub struct PasswordLoginRequestV3 {
    #[zeroize(skip)]
    pub origin: String,
    #[zeroize(skip)]
    pub request_id: String,
    pub state: String,
    pub code_verifier: String,
    #[zeroize(skip)]
    pub username: String,
    pub password: String,
}

#[derive(Clone, Serialize, Zeroize, ZeroizeOnDrop)]
pub struct OtpLoginRequestV3 {
    #[zeroize(skip)]
    pub origin: String,
    #[zeroize(skip)]
    pub request_id: String,
    pub state: String,
    pub code_verifier: String,
    pub otp: String,
}

#[derive(Clone, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct SessionTokensV3 {
    #[zeroize(skip)]
    pub token_type: String,
    pub access_token: String,
    pub refresh_token: String,
    #[zeroize(skip)]
    pub access_expires_at: String,
    #[zeroize(skip)]
    pub session_expires_at: String,
    #[zeroize(skip)]
    pub origin: String,
    #[zeroize(skip)]
    pub username: String,
    #[zeroize(skip)]
    pub role: String,
    #[zeroize(skip)]
    pub session_id: String,
    #[zeroize(skip)]
    pub device_thumbprint: String,
    #[zeroize(skip)]
    pub attestation: Option<String>,
}

impl std::fmt::Debug for SessionTokensV3 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionTokensV3")
            .field("token_type", &self.token_type)
            .field("username", &self.username)
            .field("role", &self.role)
            .field("session_id", &self.session_id)
            .field("device_thumbprint", &self.device_thumbprint)
            .field("access_token", &"[REDACTED]")
            .field("refresh_token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Serialize, Zeroize, ZeroizeOnDrop)]
pub struct RefreshRequestV3 {
    #[zeroize(skip)]
    pub origin: String,
    pub refresh_token: String,
}

#[derive(Clone, Serialize, Zeroize, ZeroizeOnDrop)]
pub struct LogoutRequestV3 {
    #[zeroize(skip)]
    pub origin: String,
    pub refresh_token: String,
}
