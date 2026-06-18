const nodemailer = require("nodemailer");

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function smtpPort() {
  const value = Number(process.env.SMTP_PORT || 587);
  return Number.isFinite(value) && value > 0 ? value : 587;
}

function smtpSecure() {
  if (process.env.SMTP_SECURE === "1") return true;
  if (process.env.SMTP_SECURE === "0") return false;
  return smtpPort() === 465;
}

function createTransporter() {
  if (!smtpConfigured()) {
    const error = new Error("邮件服务未配置");
    error.statusCode = 503;
    error.code = "smtp_not_configured";
    throw error;
  }
  const auth = process.env.SMTP_USER || process.env.SMTP_PASS
    ? {
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || ""
      }
    : undefined;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort(),
    secure: smtpSecure(),
    auth,
    connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS || 15000),
    greetingTimeout: Number(process.env.SMTP_TIMEOUT_MS || 15000),
    socketTimeout: Number(process.env.SMTP_TIMEOUT_MS || 15000)
  });
}

async function sendVerificationCode(email, code) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "智在 AI 注册验证码",
    text: [
      `你的智在 AI 注册验证码是：${code}`,
      "",
      "验证码 10 分钟内有效。如果不是你本人操作，请忽略这封邮件。"
    ].join("\n")
  });
}

module.exports = {
  smtpConfigured,
  sendVerificationCode
};
