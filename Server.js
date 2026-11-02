import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const agents = [
{
id: "master",
name: "Master AI Bot",
role: "Coordinates tasks and delegates work to specialist bots."
},
{
id: "affiliate",
name: "Affiliate Marketing Bot",
role: "Researches affiliate products and prepares promotional content."
},
{
id: "youtube",
name: "YouTube Bot",
role: "Plans videos and prepares scripts and content ideas."
},
{
id: "blogging",
name: "Blogging Bot",
role: "Researches blog topics and drafts articles."
},
{
id: "app-development",
name: "App Development Bot",
role: "Helps plan applications, generate code, and troubleshoot errors."
},
{
id: "seo",
name: "SEO Bot",
role: "Researches keywords and suggests search optimisation improvements."
}
];

app.get("/api/status", (req, res) => {
res.json({
success: true,
message: "Master AI Bot server is running.",
agents
});
});

app.get("/api/health", (req, res) => {
res.json({
success: true,
status: "healthy"
});
});

app.get("/api", (req, res) => {
res.json({
name: "Master AI Bot",
message: "Welcome to your AI automation platform.",
status: "Initial backend ready"
});
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Master AI Bot running on port ${PORT}");
});
