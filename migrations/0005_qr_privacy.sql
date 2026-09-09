-- QR privacy / situation client
ALTER TABLE company_settings ADD COLUMN qr_client_situation INTEGER DEFAULT 0;
ALTER TABLE company_settings ADD COLUMN qr_situation_ttl_days INTEGER DEFAULT 90;
ALTER TABLE company_settings ADD COLUMN client_data_retention_days INTEGER DEFAULT 1825;
