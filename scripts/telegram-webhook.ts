import dotenv from 'dotenv';
dotenv.config();

import {
  buildWebhookUrl,
  evaluateAppUrlReachability,
  fetchTelegramWebhookInfo,
  registerTelegramWebhook,
  deleteTelegramWebhook,
} from '../src/server/telegramWebhook';

async function main() {
  const action = process.argv[2] || 'status';
  console.log(`\n🤖 K-Street Order - Telegram Webhook Utility`);
  console.log(`Action: ${action}\n`);

  const reachability = evaluateAppUrlReachability();
  const webhookUrl = buildWebhookUrl();

  console.log(`Environment check:`);
  console.log(`- APP_URL: ${process.env.APP_URL || '(not set)'}`);
  console.log(`- Constructed Webhook URL: ${webhookUrl || '(not set)'}`);
  console.log(`- Public HTTPS: ${reachability.isHttps ? '✅ Yes' : '❌ No'}`);
  console.log(`- Local or Preview: ${reachability.isLocalOrPreview ? '⚠️ Yes (External Telegram webhooks may be blocked)' : '✅ No (Publicly reachable)'}`);

  if (reachability.warning) {
    console.warn(`\n⚠️  ${reachability.warning}\n`);
  }

  if (action === 'register') {
    console.log(`Registering webhook with Telegram...`);
    const result = await registerTelegramWebhook();
    console.log(`Result:`, result);
    if (result.ok) {
      console.log(`\n✅ Webhook registered successfully to: ${result.url}`);
    } else {
      console.error(`\n❌ Failed to register webhook: ${result.description}`);
    }
  } else if (action === 'delete' || action === 'remove') {
    console.log(`Removing webhook from Telegram...`);
    const result = await deleteTelegramWebhook({ dropPendingUpdates: true });
    console.log(`Result:`, result);
    if (result.ok) {
      console.log(`\n✅ Webhook removed successfully`);
    } else {
      console.error(`\n❌ Failed to remove webhook: ${result.description}`);
    }
  } else if (action === 'status') {
    console.log(`Checking Telegram getWebhookInfo...`);
    const info = await fetchTelegramWebhookInfo();
    console.log(`\nWebhook Status:`);
    console.log(`- Is Registered: ${info.isRegistered ? '✅ Yes' : '❌ No'}`);
    console.log(`- Current URL: ${info.url || '(none)'}`);
    console.log(`- Pending Updates: ${info.pendingUpdateCount}`);
    console.log(`- Last Error Date: ${info.lastErrorDate || '(none)'}`);
    console.log(`- Last Error Message: ${info.lastErrorMessage || '(none)'}`);
    console.log(`- Max Connections: ${info.maxConnections}`);
    console.log(`- Allowed Updates: ${info.allowedUpdates.join(', ') || '(all)'}`);
    console.log(`- Webhook Receiving Callbacks: ${info.isReceivingCallbacks ? '✅ Yes' : '❌ No / Pending'}`);
  } else {
    console.log(`Usage: tsx scripts/telegram-webhook.ts [register|status|delete]`);
  }
}

main().catch((err) => {
  console.error('Fatal error running telegram-webhook script:', err);
  process.exit(1);
});
