export const handler = async (event) => {
  console.log("Resolver function triggered.");

  return {
    statusCode: 200,
    body: JSON.stringify({
      linkedIssues: [
        { key: "TEST-123", sla: "4h remaining" },
        { key: "TEST-456", sla: "Breached by 1h 30m" }
      ]
    })
  };
};
