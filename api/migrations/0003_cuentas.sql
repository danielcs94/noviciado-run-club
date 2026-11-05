-- Cuenta de socio: entra con su correo y una contraseña (guardada como PBKDF2, nunca en claro).
-- Los socios de antes la tienen vacía hasta que la activan.
ALTER TABLE members ADD COLUMN password_hash TEXT;
