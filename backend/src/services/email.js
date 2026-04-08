const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function sendPasswordResetEmail(email, resetToken, userName) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
  
  const mailOptions = {
    from: `"Deemona Finance Solution" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Reset Your Password - Deemona Finance',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0d9488, #0f766e); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { color: white; margin: 0; font-size: 24px; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #0d9488; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Deemona Finance Solution</h1>
          </div>
          <div class="content">
            <p>Hello ${userName || 'there'},</p>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #0d9488;">${resetUrl}</p>
            <p><strong>This link will expire in 1 hour.</strong></p>
            <p>If you didn't request a password reset, you can safely ignore this email.</p>
            <p>Best regards,<br>The Deemona Team</p>
          </div>
          <div class="footer">
            <p>© 2026 Deemona Finance Solution. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Password reset email sent to:', email);
    return true;
  } catch (error) {
    console.error('[EMAIL] Failed to send password reset:', error);
    return false;
  }
}

module.exports = {
  sendPasswordResetEmail
};
async function sendVerificationEmail(email, verificationToken, userName) {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email.html?token=${verificationToken}`;
  
  const mailOptions = {
    from: `"Deemona Finance Solution" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Verify Your Email - Deemona Finance',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0d9488, #0f766e); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { color: white; margin: 0; font-size: 24px; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #0d9488; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to Deemona Finance!</h1>
          </div>
          <div class="content">
            <p>Hello ${userName || 'there'},</p>
            <p>Thank you for creating an account! Please verify your email address to get started:</p>
            <div style="text-align: center;">
              <a href="${verifyUrl}" class="button">Verify Email Address</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #0d9488;">${verifyUrl}</p>
            <p><strong>This link will expire in 24 hours.</strong></p>
            <p>If you didn't create this account, you can safely ignore this email.</p>
            <p>Best regards,<br>The Deemona Team</p>
          </div>
          <div class="footer">
            <p>© 2026 Deemona Finance Solution. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('[EMAIL] Failed to send verification:', error);
    return false;
  }
}
module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail
};