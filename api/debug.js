export default function handler(req, res) {
  res.status(200).json({
    env_ping_token: process.env.PING_TOKEN || "NOT FOUND"
  });
}
