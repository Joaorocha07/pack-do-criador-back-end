const prisma = require("./prisma");
const { sendDeviceBlockedEmail } = require("./mailer");

const ALERT_INTERVAL_MS = Number(process.env.DEVICE_BLOCK_ALERT_INTERVAL_MINUTES || 60) * 60 * 1000;

function shouldSendAlert(profile) {
  if (!profile?.id) {
    return false;
  }

  if (!profile.deviceBlockedEmailSentAt) {
    return true;
  }

  return Date.now() - new Date(profile.deviceBlockedEmailSentAt).getTime() > ALERT_INTERVAL_MS;
}

function sendDeviceBlockedAlert(user) {
  const profile = user?.profile;

  if (!user?.email || !shouldSendAlert(profile)) {
    return;
  }

  prisma.userProfile
    .update({
      where: { id: profile.id },
      data: { deviceBlockedEmailSentAt: new Date() }
    })
    .then(() =>
      sendDeviceBlockedEmail({
        to: user.email,
        name: user.name
      })
    )
    .catch((error) => {
      console.error("[device:block] Falha ao enviar aviso de aparelho bloqueado.", {
        userId: user.id,
        message: error.message
      });
    });
}

module.exports = { sendDeviceBlockedAlert };
