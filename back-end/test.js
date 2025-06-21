const { runAgent } = require('./index');

async function test() {
  const queries = [
    "Show me a bar chart component",
    "I need a data grid with filtering",
    "What components are available for dashboards?"
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    const response = await runAgent(query);
    console.log("Response:", response);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Add delay between queries
  }
}

test();