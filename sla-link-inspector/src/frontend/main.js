import { invoke } from '@forge/bridge';


console.log("Main.js loaded and running.");

// Render SLA table
function renderSLATable(tickets) {
  const tableBody = document.querySelector("#sla-table tbody");
  tableBody.innerHTML = '';  // Clear existing rows

  tickets.forEach(ticket => {
    const row = document.createElement("tr");

    const ticketCell = document.createElement("td");
    ticketCell.textContent = ticket.key;

    const slaCell = document.createElement("td");
    slaCell.textContent = ticket.sla;

    // Optional: Highlight breached SLAs
    if (ticket.sla.includes("Breached")) {
      slaCell.style.color = "red";
      slaCell.style.fontWeight = "bold";
    } else if (ticket.sla.includes("remaining")) {
      slaCell.style.color = "green";
    }

    row.appendChild(ticketCell);
    row.appendChild(slaCell);

    tableBody.appendChild(row);
  });
}

// Replace this with the actual current issue ID (for testing, use a known issue)
const currentIssueId = "NSGHTTST-8021";

// Fetch linked issues and SLA data from Forge backend
invoke('resolver', { context: { issueId: currentIssueId } }).then((response) => {
  const data = JSON.parse(response.body);

  console.log('Linked Issues from backend:', data.linkedIssues);

  const linkedTickets = data.linkedIssues;  // Use as-is, contains [{ key, sla }]

  renderSLATable(linkedTickets);

}).catch(err => {
  console.error('Failed to fetch linked issues:', err);

  renderSLATable([
    { key: "Error loading issues", sla: "Check console logs." }
  ]);
});
