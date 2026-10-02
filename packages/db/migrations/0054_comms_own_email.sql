-- Compose can send an email written on the spot (no template): such a request has no template; its
-- channels entry is {channel: 'email', templateId: null, custom: true} and the subject lives on the request.
ALTER TABLE message_requests ALTER COLUMN template_id DROP NOT NULL;
