export default function handler(req, res) {
  const token = req.query.token;

  if (token !== process.env.PING_TOKEN) {
    return res.status(403).json({ error: "invalid token" });
  }

  return res.status(200).json({ ok: true });
}

console.log("TOKEN SALVO NA VERCEL:", process.env.PING_TOKEN);
