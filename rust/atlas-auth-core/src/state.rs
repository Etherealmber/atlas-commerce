use crate::dpop::DeviceKeyAdapter;
use crate::error::{AuthCoreError, Result};
use crate::origin::ServerOrigin;
use crate::pkce::{validate_pairing_code, PkcePair};
use crate::schemas::{
    CapabilitiesV3Response, ChallengePollResponse, ChallengeVerifyStatus, CreateRequestV3Body,
    CreateRequestV3Response, LogoutResponseV3, OtpLoginRequestV3, PasswordLoginRequestV3,
    SessionTokensV3,
};
use serde::{Deserialize, Serialize};
use zeroize::ZeroizeOnDrop;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChallengePresentation {
    TurnstileWebview,
    SystemBrowser,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopV3Phase {
    Idle,
    AwaitingChallenge,
    ChallengeVerified,
    AwaitingOtp,
    Authenticated,
    LoggedOut,
    Cancelled,
    Failed,
}

impl DesktopV3Phase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::AwaitingChallenge => "awaiting_challenge",
            Self::ChallengeVerified => "challenge_verified",
            Self::AwaitingOtp => "awaiting_otp",
            Self::Authenticated => "authenticated",
            Self::LoggedOut => "logged_out",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

/// Explicit state machine for a single Desktop v3 authentication attempt.
/// Never silently switches between `TurnstileWebview` and `SystemBrowser`,
/// and never inspects WebView cookies, storage, or Turnstile tokens.
#[derive(ZeroizeOnDrop)]
pub struct DesktopV3AuthSession {
    #[zeroize(skip)]
    origin: ServerOrigin,
    #[zeroize(skip)]
    presentation: ChallengePresentation,
    #[zeroize(skip)]
    phase: DesktopV3Phase,
    pkce: PkcePair,
    #[zeroize(skip)]
    device_label: String,
    #[zeroize(skip)]
    request_id: Option<String>,
    #[zeroize(skip)]
    pairing_code: Option<String>,
    #[zeroize(skip)]
    challenge_url: Option<String>,
    #[zeroize(skip)]
    device_thumbprint: Option<String>,
}

impl std::fmt::Debug for DesktopV3AuthSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DesktopV3AuthSession")
            .field("origin", &self.origin.as_str())
            .field("presentation", &self.presentation)
            .field("phase", &self.phase)
            .field("request_id", &self.request_id)
            .finish()
    }
}

impl DesktopV3AuthSession {
    pub fn new(
        origin: ServerOrigin,
        presentation: ChallengePresentation,
        device_label: &str,
        capabilities: &CapabilitiesV3Response,
    ) -> Result<Self> {
        if capabilities.version != 3
            || !capabilities.enabled
            || !capabilities.methods.password_otp.available
            || !capabilities.methods.device_proof.available
            || capabilities.methods.device_proof.hardware_attestation_claimed
        {
            return Err(AuthCoreError::NotReady);
        }
        if !capabilities
            .methods
            .password_otp
            .challenge_modes
            .contains(&presentation)
        {
            return Err(AuthCoreError::SilentFallbackForbidden);
        }
        let clean = device_label.trim();
        if clean.is_empty() || clean.len() > 60 || clean.chars().any(|c| c.is_control() || c == '<' || c == '>') {
            return Err(AuthCoreError::InvalidDeviceLabel);
        }

        Ok(Self {
            origin,
            presentation,
            phase: DesktopV3Phase::Idle,
            pkce: PkcePair::generate()?,
            device_label: clean.to_string(),
            request_id: None,
            pairing_code: None,
            challenge_url: None,
            device_thumbprint: None,
        })
    }

    pub fn phase(&self) -> DesktopV3Phase {
        self.phase
    }

    pub fn presentation(&self) -> ChallengePresentation {
        self.presentation
    }

    pub fn create_request_body(&self) -> Result<CreateRequestV3Body<'_>> {
        if self.phase != DesktopV3Phase::Idle {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "create_request",
            });
        }
        Ok(CreateRequestV3Body {
            origin: self.origin.as_str(),
            state: self.pkce.state(),
            code_challenge: self.pkce.code_challenge(),
            code_challenge_method: "S256",
            device_label: &self.device_label,
            presentation: self.presentation,
        })
    }

    pub fn apply_created(
        &mut self,
        resp: &CreateRequestV3Response,
        key: &dyn DeviceKeyAdapter,
    ) -> Result<()> {
        if self.phase != DesktopV3Phase::Idle {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "apply_created",
            });
        }
        if resp.version != 3
            || resp.origin != self.origin.as_str()
            || resp.presentation != self.presentation
            || resp.request_id.len() != 64
            || !resp.request_id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            || resp.device_thumbprint != key.thumbprint()
        {
            return Err(AuthCoreError::ResponseMismatch);
        }
        validate_pairing_code(&resp.pairing_code)?;
        let expected_path = match self.presentation {
            ChallengePresentation::TurnstileWebview => "/login/desktop-v3-challenge",
            ChallengePresentation::SystemBrowser => "/login/desktop-v3-browser",
        };
        self.origin
            .validate_challenge_url(&resp.challenge_url, expected_path, &resp.request_id)?;

        self.request_id = Some(resp.request_id.clone());
        self.pairing_code = Some(resp.pairing_code.clone());
        self.challenge_url = Some(resp.challenge_url.clone());
        self.device_thumbprint = Some(resp.device_thumbprint.clone());
        self.phase = DesktopV3Phase::AwaitingChallenge;
        Ok(())
    }

    pub fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }

    pub fn challenge_url(&self) -> Option<&str> {
        self.challenge_url.as_deref()
    }

    pub fn pairing_code(&self) -> Option<&str> {
        self.pairing_code.as_deref()
    }

    pub fn apply_poll(&mut self, poll: &ChallengePollResponse) -> Result<ChallengeVerifyStatus> {
        if self.phase != DesktopV3Phase::AwaitingChallenge {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "apply_poll",
            });
        }
        if Some(poll.request_id.as_str()) != self.request_id.as_deref()
            || poll.origin != self.origin.as_str()
        {
            return Err(AuthCoreError::ResponseMismatch);
        }
        match poll.status {
            ChallengeVerifyStatus::Pending | ChallengeVerifyStatus::Verifying => {}
            ChallengeVerifyStatus::Verified => self.phase = DesktopV3Phase::ChallengeVerified,
            ChallengeVerifyStatus::Cancelled => self.phase = DesktopV3Phase::Cancelled,
            ChallengeVerifyStatus::Denied
            | ChallengeVerifyStatus::Failed
            | ChallengeVerifyStatus::Consumed => self.phase = DesktopV3Phase::Failed,
        }
        Ok(poll.status)
    }

    pub fn build_password_login(&self, username: &str, password: &str) -> Result<PasswordLoginRequestV3> {
        if self.phase != DesktopV3Phase::ChallengeVerified {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "build_password_login",
            });
        }
        let req_id = self
            .request_id
            .as_ref()
            .ok_or(AuthCoreError::ResponseMismatch)?
            .clone();
        Ok(PasswordLoginRequestV3 {
            origin: self.origin.as_str().to_string(),
            request_id: req_id,
            state: self.pkce.state().to_string(),
            code_verifier: self.pkce.code_verifier().to_string(),
            username: username.trim().to_lowercase(),
            password: password.to_string(),
        })
    }

    pub fn mark_otp_pending(&mut self) -> Result<()> {
        if self.phase != DesktopV3Phase::ChallengeVerified {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "mark_otp_pending",
            });
        }
        self.phase = DesktopV3Phase::AwaitingOtp;
        Ok(())
    }

    pub fn build_otp_login(&self, otp: &str) -> Result<OtpLoginRequestV3> {
        if self.phase != DesktopV3Phase::AwaitingOtp {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "build_otp_login",
            });
        }
        let req_id = self
            .request_id
            .as_ref()
            .ok_or(AuthCoreError::ResponseMismatch)?
            .clone();
        Ok(OtpLoginRequestV3 {
            origin: self.origin.as_str().to_string(),
            request_id: req_id,
            state: self.pkce.state().to_string(),
            code_verifier: self.pkce.code_verifier().to_string(),
            otp: otp.trim().to_string(),
        })
    }

    pub fn apply_authenticated(
        &mut self,
        tokens: &SessionTokensV3,
        key: &dyn DeviceKeyAdapter,
    ) -> Result<()> {
        if self.phase != DesktopV3Phase::AwaitingOtp {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "apply_authenticated",
            });
        }
        let expected_thumbprint = self
            .device_thumbprint
            .as_deref()
            .ok_or(AuthCoreError::ResponseMismatch)?;
        if tokens.token_type != "DPoP"
            || tokens.origin != self.origin.as_str()
            || tokens.device_thumbprint != key.thumbprint()
            || tokens.device_thumbprint != expected_thumbprint
            || !tokens.access_token.starts_with("nv3.")
        {
            return Err(AuthCoreError::ResponseMismatch);
        }
        self.phase = DesktopV3Phase::Authenticated;
        Ok(())
    }

    pub fn apply_refreshed(
        &mut self,
        tokens: &SessionTokensV3,
        key: &dyn DeviceKeyAdapter,
    ) -> Result<()> {
        if self.phase != DesktopV3Phase::Authenticated {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "apply_refreshed",
            });
        }
        let expected_thumbprint = self
            .device_thumbprint
            .as_deref()
            .ok_or(AuthCoreError::ResponseMismatch)?;
        if tokens.token_type != "DPoP"
            || tokens.origin != self.origin.as_str()
            || tokens.device_thumbprint != key.thumbprint()
            || tokens.device_thumbprint != expected_thumbprint
            || !tokens.access_token.starts_with("nv3.")
        {
            return Err(AuthCoreError::ResponseMismatch);
        }
        Ok(())
    }

    pub fn mark_logged_out(&mut self, resp: &LogoutResponseV3) -> Result<()> {
        if self.phase != DesktopV3Phase::Authenticated {
            return Err(AuthCoreError::InvalidTransition {
                from: self.phase.as_str(),
                action: "mark_logged_out",
            });
        }
        if resp.status != "revoked" {
            return Err(AuthCoreError::ResponseMismatch);
        }
        self.phase = DesktopV3Phase::LoggedOut;
        Ok(())
    }

    pub fn cancel(&mut self) {
        self.phase = DesktopV3Phase::Cancelled;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dpop::SoftwareP256Key;
    use crate::schemas::{
        CapabilitiesV3Methods, DeviceProofCapabilityV3, PasswordOtpMethodV3, SimpleCapabilityV3,
    };

    fn ready_caps() -> CapabilitiesV3Response {
        CapabilitiesV3Response {
            version: 3,
            enabled: true,
            reason: None,
            methods: CapabilitiesV3Methods {
                password_otp: PasswordOtpMethodV3 {
                    available: true,
                    challenge_modes: vec![
                        ChallengePresentation::TurnstileWebview,
                        ChallengePresentation::SystemBrowser,
                    ],
                    automatic_fallback: false,
                    otp_required: true,
                    dpop_required: true,
                    verified_mailbox_required: true,
                },
                mailbox_enrollment: SimpleCapabilityV3 { available: true },
                recovery: SimpleCapabilityV3 { available: true },
                device_proof: DeviceProofCapabilityV3 {
                    available: true,
                    hardware_attestation_claimed: false,
                },
            },
        }
    }

    #[test]
    fn enforces_strict_state_machine_and_rejects_mismatched_presentation() {
        let origin = ServerOrigin::parse("https://stock.afmarbre.com").unwrap();
        let key = SoftwareP256Key::generate().unwrap();
        let mut session = DesktopV3AuthSession::new(
            origin.clone(),
            ChallengePresentation::TurnstileWebview,
            "Poste Bureau",
            &ready_caps(),
        )
        .unwrap();

        let synthetic_input = SoftwareP256Key::generate().unwrap().thumbprint();
        assert!(session.build_password_login("alice", &synthetic_input).is_err());

        let req_id = "a".repeat(64);
        let created = CreateRequestV3Response {
            version: 3,
            request_id: req_id.clone(),
            origin: origin.as_str().to_string(),
            presentation: ChallengePresentation::TurnstileWebview,
            challenge_url: format!(
                "https://stock.afmarbre.com/login/desktop-v3-challenge#request_id={}",
                req_id
            ),
            pairing_code: "ABCDE-12345".to_string(),
            device_thumbprint: key.thumbprint(),
            expires_in: 300,
            interval: 5,
        };
        session.apply_created(&created, &key).unwrap();
        assert_eq!(session.phase(), DesktopV3Phase::AwaitingChallenge);

        let poll = ChallengePollResponse {
            status: ChallengeVerifyStatus::Verified,
            request_id: req_id,
            origin: origin.as_str().to_string(),
            interval: 5,
        };
        session.apply_poll(&poll).unwrap();
        assert_eq!(session.phase(), DesktopV3Phase::ChallengeVerified);
        assert!(session.build_password_login("alice", &synthetic_input).is_ok());
    }
}
