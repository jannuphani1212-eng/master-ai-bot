const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
res.setHeader("Content-Type", "application/json");

if (req.url === "/api/status" && req.method === "GET") {
res.writeHead(200);
res.end(JSON.stringify({
success: true,
message: "Master AI Bot server is running!",
agents: [
"Master AI Bot",
"Affiliate Marketing Bot",
"YouTube Bot",
"Blogging Bot",
"App Development Bot",
"SEO Bot"
]
}));
return;
}

res.writeHead(200);
res.end(JSON.stringify({
message: "Welcome to Master AI Bot",
status: "Initial backend created"
}));
});

server.listen(PORT, "0.0.0.0", () => {
console.log("Master AI Bot server listening on port ${PORT}");
});
