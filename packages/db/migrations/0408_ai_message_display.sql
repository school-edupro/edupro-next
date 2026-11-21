-- 0408: the chatbot's answers keep what was shown with them (docs/design/91): the record card (figures or a short
-- table), the screen to open, the follow-up questions and the "did you mean" choices — so a conversation opened
-- again shows its answers as they were. Answered by EduPro's own matcher (no outside model).
ALTER TABLE ai_messages ADD COLUMN display JSONB CHECK (display IS NULL OR jsonb_typeof(display) = 'object');
