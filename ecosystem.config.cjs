// pm2 process file for the VPS: `pm2 start ecosystem.config.cjs`
module.exports = {
  apps: [
    { name: "paperclip-api", cwd: __dirname, script: "npm", args: "start -- -p 3000", env: { NODE_ENV: "production" } },
    { name: "paperclip-agent", cwd: __dirname, script: "npm", args: "run agent", env: { NODE_ENV: "production" } },
  ],
};
