const linkedTickets = [
  { key: "NSGHTTST-123", sla: "3h 25m remaining" },
  { key: "NSGHTTST-456", sla: "Breached by 2h 15m" },
  { key: "NSGHTTST-789", sla: "1h 10m remaining" }
];

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
    } else {
      slaCell.style.color = "green";
    }

    row.appendChild(ticketCell);
    row.appendChild(slaCell);

    tableBody.appendChild(row);
  });
}

// Initialize the dashboard
renderSLATable(linkedTickets);
