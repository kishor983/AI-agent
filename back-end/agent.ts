import OpenAI from 'openai'
import { ChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
let session:Map<string,BufferMemory>=new Map();
export async function runAgent(param: any) {
  const client = new OpenAI({
    apiKey: "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",
    baseURL: 'https://models.github.ai/inference'
  })
  try {
    
  } catch (error) {
    
  }
 let res=await client.chat.completions.create({
    model: 'openai/gpt-4.1',
    messages : [
      {
        role: "system",
        content: `You are a friendly AI assistant. Your job is to greet people in a warm and human-like manner based on the tone of their message.
    
    Use the following reference provided between --- for style of response:
    ---
    1. "Hello ladies and gentlemen, have a good day welcome"
    2. "Hey Hi nice to meet you all have a sweet day"
    ---
    Adapt your greeting style to match the tone of the user's input.`,
      },
      {
        role: "user",
        content: param, // example: "Hey there!" or "Good morning all"
      },
    ],
    
    temperature: 2
  })
  
 console.log(res.choices[0].message.content);
 
}
export async function AskAgent(param: any) {


  // 🔹 Initialize the LLM
  const llm = new ChatOpenAI({
    apiKey: "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",
    model: "openai/gpt-4.1",
    temperature: 0.7,
    configuration: { baseURL: "https://models.github.ai/inference" }
  });

  // 🔹 Session Memory Handling
  const session = new Map();
  function getSessionMemory(id: string) {
    if (session.has(id)) return session.get(id);
    const mem = new BufferMemory();
    session.set(id, mem);
    return mem;
  }

  // 🔹 TOOL: Generate Chart Description
  async function generateDescription(params: any) {
    const { chart } = params;
    const memory = getSessionMemory(chart.sessionId);
    const chain = new ConversationChain({ llm, memory });

    const prompt=`Role:
   You are a Data Analyst specializing in data visualization and chart interpretation. Your task is to generate accurate, concise, and insightful descriptions for charts based on provided data.
   
   Objective:
   Create a clear and informative description of the given chart, highlighting key trends, patterns, and notable data points to make the visualization easily understandable for stakeholders.
   
   Context:
   Chart Title: ${chart.title}
   
   Chart Data: ${JSON.stringify(chart.data)}
   
   Chart Labels: ${chart.labels}
   
   Instructions:
   Instruction 1: Summarize the Chart
   Briefly state the chart’s purpose and type (e.g., bar, line, pie).
   
   Mention the variables/axes represented (e.g., "X-axis: Time, Y-axis: Revenue").
   
   Instruction 2: Highlight Key Insights
   Identify trends (e.g., growth, decline, seasonality).
   
   Point out outliers, peaks, or anomalies.
   
   Compare significant data points if applicable.
   
   Instruction 3: Keep It Concise & Actionable
   Use plain language; avoid jargon unless necessary.
   
   If relevant, suggest a takeaway (e.g., "Marketing spend correlates with sales").
   
   Limit to 3–5 sentences unless complexity demands more.
   
   Notes:
   Note 1: If the chart lacks labels, infer context from the data structure.
   
   Note 2: For time-series data, emphasize trends over static values.
   
   Note 3: Use bullet points or numbered lists only if it improves clarity.
   
   `;

    const response = await chain.call({ input: prompt });
    return response.response;
  }

  // 🔹 TOOL: Answer Q&A About Chart
  async function answerQuestion(params: any) {
    const { chart, sessionId, question } = params;
    const memory = getSessionMemory(sessionId);
    const chain = new ConversationChain({ llm, memory });

    const prompt = `You are assisting with Q&A about the chart "${chart.title}".
    Data: ${JSON.stringify(chart.data)}
    Question: ${question}`;

    const response = await chain.call({ input: prompt });
    return response.response;
  }

  // (plug-and-play)
  const tools: Record<string, { description: string; fn: Function }> = {
    generate_description: { description: "Generate chart descriptions", fn: generateDescription },
    answer_question: { description: "Answer questions about a chart", fn: answerQuestion }
  };
  

  // /detect intent & choose tool
  const agentPrompt = `Role: You are an AI orchestrator. 
Given the user input: ${JSON.stringify(param)}, 
analyze it and return ONLY a JSON object describing which tool to call and with what parameters.

The JSON must strictly follow this schema:
{
  "intent": "tool_call",
  "tool_name": "<one of: ${Object.keys(tools).join(", ")}>",
  "params": { ... } 
}

Example:
{
  "intent": "tool_call",
  "tool_name": "generate_description",
  "params": { "chart": { "title": "Sales", "data": [1,2,3], "labels": ["Jan","Feb","Mar"], "sessionId": "123" } }
}`;

  // 🔹 LLM Decides Which Tool to Call
  const agentChain = new ConversationChain({ llm, memory: new BufferMemory() });
  const toolSelectionResponse = await agentChain.call({ input: agentPrompt });

  let toolCall;
  try {
    toolCall = JSON.parse(toolSelectionResponse.response);
  } catch (err) {
    console.error("❌ Failed to parse LLM response:", toolSelectionResponse.response);
    return { response: "Invalid response from orchestrator. Please retry." };
  }

  // 🔹 Validate Tool & Execute
  const selectedTool = tools[toolCall.tool_name];
  if (!selectedTool) {
    return { response: `❌ Tool '${toolCall.tool_name}' not found. Available tools: ${Object.keys(tools).join(", ")}` };
  }

  try {
    const result = await selectedTool.fn(toolCall.params);
    return { response: result };
  } catch (err) {
    console.error("❌ Tool execution error:", err);
    return { response: "An error occurred while executing the requested tool." };
  }
}


// AskAgent('hiiiii');
// runAgent("Hey there!",)