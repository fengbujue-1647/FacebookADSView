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

function normalizeSendError(error) {
  const details = [
    error?.message,
    error?.response,
    error?.code,
    error?.command
  ].filter(Boolean).join(" ");
  const normalized = new Error("验证码邮件发送失败，请稍后再试");
  normalized.statusCode = Number.isFinite(Number(error?.responseCode)) ? Number(error.responseCode) : 502;
  normalized.code = "send_email_failed";
  normalized.providerMessage = details.slice(0, 500);

  if (/You can only send testing emails to your own email address|verify a domain at/i.test(details)) {
    normalized.statusCode = 503;
    normalized.code = "resend_testing_recipient_restricted";
    normalized.message = "当前邮件服务处于 Resend 测试模式，只能发送到发信账号自己的邮箱。请先在 Resend 验证 zhizai.art 发信域名后再开放注册。";
    return normalized;
  }
  if (/Invalid login|Authentication|535|EAUTH/i.test(details)) {
    normalized.statusCode = 503;
    normalized.code = "smtp_auth_failed";
    normalized.message = "邮件服务认证失败，请检查 SMTP 用户名、密码或授权码。";
    return normalized;
  }
  if (/ETIMEDOUT|ESOCKET|ECONNREFUSED|ENOTFOUND|timeout/i.test(details)) {
    normalized.statusCode = 503;
    normalized.code = "smtp_connection_failed";
    normalized.message = "邮件服务连接失败，请检查 SMTP 主机、端口和网络。";
  }
  return normalized;
}

async function sendVerificationCode(email, code) {
  const transporter = createTransporter();
  try {
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
  } catch (error) {
    throw normalizeSendError(error);
  }
}

module.exports = {
  smtpConfigured,
  normalizeSendError,
  sendVerificationCode
};
