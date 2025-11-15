import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ----------------- ESTADO DO USUÁRIO -----------------
export async function getUserState(phone) {
  return (await redis.get(`state:${phone}`)) || { step: "menu", temp: {} };
}

export async function setUserState(phone, data) {
  await redis.set(`state:${phone}`, data);
}

// ----------------- PREVENÇÃO DE DUPLICIDADE -----------------
export async function isDuplicateMessage(msgId) {
  const exists = await redis.get(`msg:${msgId}`);
  if (exists) return true;

  await redis.set(`msg:${msgId}`, true, { ex: 40 }); // Expira em 40s
  return false;
}
