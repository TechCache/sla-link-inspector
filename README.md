# SLA Link Inspector

A Jira Cloud app that displays the SLA status of linked tickets from other project queues directly within the current issue view.

Built by **TechCache**, this tool helps support and operational teams monitor upstream SLA dependencies and avoid surprises when handling linked issues.

---

## 📦 Features

- Detects and lists linked issues from a specified project (e.g., NSGHTTST)
- Fetches and displays each linked ticket's SLA status (e.g., Time to First Response)
- Visual indicators for breached, at-risk, or on-track SLAs
- Seamless integration with Jira Cloud via Atlassian Forge
- Secure, lightweight, and fully contained within the issue view panel

---

## 🚀 Installation (Developer Setup)

1. **Clone the Repository**

```bash
git clone https://github.com/TechCache/sla-link-inspector.git
cd sla-link-inspector
