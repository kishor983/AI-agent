import OpenAI from "openai";
import dotenv from "dotenv";
// Remove import assertions and rely on tsconfig.json resolveJsonModule
import componentJson from "../angular_components.json";
import sourceData from "../data/source.json";

dotenv.config();

interface AnalysisPlan {
  [focusArea: string]: {
    metrics: string[];
    dateField?: string;
  };
}
interface Component {
  component: string;
  description: string;
  inputs: string[];
  outputs: string[];
}
let UserInput = '';
interface DataRecord {
  [key: string]: string | number | undefined;
}

interface Insight {
  keyFindings: Array<{
    type: string;
    description: string;
    value?: number;
    data?: Array<{ date: string; value: number }>;
  }>;
  businessImplications: string[];
  recommendedActions: string[];
  visualizationStrategies: Array<{
    primary: string;
    component: string;
    purpose: string;
    dataMapping: Record<string, any>;
    configuration: Record<string, any>;
  }>;
}

interface AnalysisResults {
  dataAnalysis?: Record<string, any>;
  fieldSemantics?: Record<string, any>;
  insights?: Insight;
}

const DYNAMIC_SYSTEM_PROMPT = `
You are an advanced data analysis assistant for Angular applications, specializing in generating insights and recommending diverse visualizations. 
Analyze the user input to understand the intent (e.g., aggregate metrics, trends, comparisons) and use the provided data from source.json to generate actionable insights.
Select visualization components from angular_components.json that best suit the intent and data characteristics, ensuring variety and avoiding repetitive outputs.
Generate detailed JSON configurations for each recommended component, including data mappings, labels, and styling options.
Focus on patterns, relationships, and business context, and provide clear, natural-language explanations for the recommendations.

**Tool Usage Instructions**:
1. **Field Extraction**: Identify fields mentioned in the input (e.g., "resolved tickets" → ["resolved"]). Default to ["resolved"] if none are mentioned.
2. **Focus Areas**: Extract analysis types (e.g., "trend", "total", "performance") for focusAreas.
3. **Analysis Depth**: Use "detailed" for analysisDepth unless "basic" is explicitly requested (e.g., "simple analysis").
4. **Tool Sequencing**:
   - Call "analyzeDynamically" first to compute metrics for the specified focusAreas and targetFields.
   - Only call "generateDynamicInsights" after "analyzeDynamically" produces results, using its metrics output as dataFindings.
   - Call "inferFieldMeanings" if field meanings are unclear.
   - Call "buildDeveloperResponse" to finalize visualization configs after insights are generated.
5. **Avoid Premature Calls**: Do not call "generateDynamicInsights" without valid dataFindings.

Example Input: "Analyze the trend and total count of resolved tickets."
Example Output: [
  {
    "name": "analyzeDynamically",
    "parameters": {
      "focusAreas": ["trend", "total"],
      "analysisDepth": "detailed",
      "targetFields": ["resolved"]
    }
  }
]
`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    "type": "function",
    "function": {
      "name": "analyzeDynamically",
      "description": "Analyzes data dynamically based on focus areas (e.g., 'trend', 'performance', 'total'), target fields (e.g., 'resolved', 'ticket'), and a date field for time-series analysis. All parameters are required, inferred from user input if not explicitly specified. Returns a clarification request if inference fails.",
      "parameters": {
        "type": "object",
        "properties": {
          "focusAreas": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Analysis types (e.g., 'trend', 'performance', 'total'). Inferred from input (e.g., 'growth' → 'trend')."
          },
          "analysisDepth": {
            "type": "string",
            "enum": ["basic", "detailed"],
            "description": "Depth of analysis. Inferred as 'detailed' unless 'basic' or 'simple' is specified."
          },
          "targetFields": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Fields to analyze (e.g., 'resolved'). Inferred from input or defaults to 'resolved' if ambiguous."
          }
        },
        "required": ["focusAreas", "analysisDepth", "targetFields"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inferFieldMeanings",
      description: "Infers semantic meanings of data fields",
      parameters: {
        type: "object",
        properties: { fields: { type: "array", items: { type: "string" } } },
        required: ["fields"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generateDynamicInsights",
      description: "Generates insights and visualization recommendations based on user intent and data findings from analyzeDynamically",
      parameters: {
        type: "object",
        properties: {
          userIntent: { type: "string" },
          dataFindings: { type: "object", description: "Metrics output from analyzeDynamically" },
        },
        required: ["userIntent", "dataFindings"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buildDeveloperResponse",
      description: "Builds a response with JSON configs for visualization components",
      parameters: {
        type: "object",
        properties: {
          recommendations: { type: "array", items: { type: "object" } },
          insights: { type: "object" },
        },
        required: ["recommendations", "insights"],
      },
    },
  },
];

const componentList: Component[] = componentJson.map((comp: any) => ({
  component: comp.component,
  description: comp.description,
  inputs: comp.inputs || [],
  outputs: comp.outputs || [],
}));
function isValidAnalysisPlan(obj: any): obj is AnalysisPlan {
  return (
    obj &&
    Array.isArray(obj.keyFindings) &&
    Array.isArray(obj.businessImplications) &&
    Array.isArray(obj.recommendedActions) &&
    Array.isArray(obj.visualizationStrategies)
  );
}
async function callAIToGeneratePlan(
  focusAreas: string[],
  userPrompt: string,
  fieldMetadata: any
): Promise<AnalysisPlan> {
  // Input validation
  if (!Array.isArray(focusAreas)) {
    console.error("Invalid focusAreas: must be an array");
    return {};
  }
  if (typeof userPrompt !== "string" || !userPrompt.trim()) {
    console.error("Invalid userPrompt: must be a non-empty string");
    return {};
  }
  if (!fieldMetadata || typeof fieldMetadata !== "object" || !Object.keys(fieldMetadata).length) {
    console.error("Invalid fieldMetadata: must be a non-empty object");
    return {};
  }

  // Use environment variable for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY environment variable");
    return {};
  }

  const client = new OpenAI({
    baseURL: "https://models.github.ai/inference",// Correct OpenAI endpoint
    apiKey,
  });

  const systemPrompt = `
You are an analytics planning assistant.
Given a list of focus areas and available dataset fields,
suggest a JSON plan for each focus area with:
- Relevant metrics to compute (choose from: sum, avg, ratio, time_series)
- A date field (only if time_series is used)
Only use fields from this list: ${Object.keys(fieldMetadata).join(", ")}.
Return only valid JSON in this format:

{
  "focusArea1": { "metrics": [...], "dateField": "..." },
  "focusArea2": { "metrics": [...] }
}
`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Focus areas: ${JSON.stringify(focusAreas)}\nUser prompt: ${userPrompt}` },
  ];

  try {
    const response = await client.chat.completions.create({
      model: "openai/gpt-4.1-mini", // Use a verified model (adjust as needed)
      messages,
    });

    // Validate response structure
    if (!response.choices?.[0]?.message?.content) {
      console.error("Invalid API response: no content received");
      return {};
    }

    const content = response.choices[0].message.content;

    // Parse JSON response
    try {
      const parsedPlan = JSON.parse(content);
      if (typeof parsedPlan !== "object" || parsedPlan === null) {
        console.error("Parsed response is not a valid object:", content);
        return {};
      }
      return parsedPlan;
    } catch (e) {
      console.error("Failed to parse AI response as JSON:", content, e);
      return {};
    }
  } catch (e) {
    console.error("API call failed:", (e as Error).message);
    return {};
  }
}
function calculateAdditionalMetrics(timeSeries: Array<{ date: string; value: number }>): {
  trendSlope: number;
  seasonality: string;
  outliers: Array<{ date: string; value: number }>;
  sparsity: number;
} {
  const values = timeSeries.map(item => item.value).filter(v => !isNaN(v));
  const dates = timeSeries.map(item => item.date);

  const n = values.length;
  if (n === 0) {
    return {
      trendSlope: 0,
      seasonality: "none",
      outliers: [],
      sparsity: 1,
    };
  }

  // Trend Slope (using linear regression)
  const indices = Array.from({ length: n }, (_, i) => i);
  const meanX = indices.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  const numerator = indices.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0);
  const denominator = indices.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  const trendSlope = denominator ? numerator / denominator : 0;

  // Seasonality (check for monthly autocorrelation at lag 12)
  const autocorrelation = (lag: number) => {
    const shifted = values.slice(lag);
    const original = values.slice(0, values.length - lag);
    const mean = meanY;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const covariance = shifted.reduce((sum, v, i) => sum + (v - mean) * (original[i] - mean), 0) / shifted.length;
    return variance ? covariance / variance : 0;
  };
  const seasonality = values.length >= 24 && autocorrelation(12) > 0.3 ? "monthly" : "none";

  // Outliers (outside avg ± 2 * stdDev)
  const variance =
    values.reduce((sum, v) => sum + (v - meanY) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const outliers = timeSeries.filter(
    item => item.value > meanY + 2 * stdDev || item.value < meanY - 2 * stdDev
  );

  // Sparsity (missing months between first and last date)
  const expectedDates: string[] = [];
  const firstDate = new Date(dates[0]);
  const lastDate = new Date(dates[dates.length - 1]);
  let currentDate = new Date(firstDate);
  while (currentDate <= lastDate) {
    expectedDates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  const sparsity = 1 - dates.length / expectedDates.length;

  return { trendSlope, seasonality, outliers, sparsity };
}

// Predictive analytics function
async function predictTrends(
  stats: any,
  field: string,
  dateField: string,
  data: DataRecord[],
  forecastPeriods: number = 3
): Promise<{ date: string; value: number }[] | { error: string }> {
  // Validate inputs
  if (!field || !dateField || !data || data.length < 2) {
    return { error: "Invalid input: field, dateField, or sufficient data missing" };
  }

  // Extract time-series data
  const timeSeries = data
    .filter(row => row[field] !== undefined && row[dateField] !== undefined)
    .map(row => ({
      date: row[dateField] as string,
      value: Number(row[field]),
    }))
    .filter(item => !isNaN(item.value))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (timeSeries.length < 2) {
    return { error: "Insufficient valid data for forecasting" };
  }
  let {
    trendSlope,
    seasonality,
    outliers,
    sparsity,
  } = calculateAdditionalMetrics(timeSeries);
  // Prepare prompt for OpenAI
  const systemPrompt = `
  You are a predictive analytics expert tasked with forecasting future values for the next ${forecastPeriods} periods based on historical time-series data and statistical summaries. Your goal is to produce accurate, realistic predictions that align with the data's patterns and business context.
  
  **Input Data**:
  - **Time-Series Data**: Array of { date: string, value: number } representing historical values (e.g., resolved tickets per month).
  - **Statistical Summary**:
    - min: ${stats.min} (minimum value in the dataset)
    - max: ${stats.max} (maximum value in the dataset)
    - avg: ${stats.avg} (average value)
    - sum: ${stats.sum} (total sum of values)
    - variance: ${stats.variance} (variance of values)
    - trendSlope: ${trendSlope} (linear trend slope, positive for increasing, negative for decreasing)
    - seasonality: ${seasonality} (indicates if periodic patterns exist, e.g., "monthly" or "none")
    - outliers: ${JSON.stringify(outliers)} (array of dates with values > avg + 2 * sqrt(variance))
    - sparsity: ${sparsity} (proportion of missing/null values, 0 to 1)
  - **Business Context**: The data represents ticket resolution metrics (e.g., number of resolved tickets per month). Predictions should be practical for operational planning.
  
  **Historical Data**:
  ${JSON.stringify(timeSeries, null, 2)}
  
  **Instructions**:
  1. **Forecasting**:
     - Generate forecasts for the next ${forecastPeriods} periods in the format: [{ date: string, value: number }, ...].
     - Assume monthly intervals starting from the last date in the data (e.g., if last date is "2025-06-01", next is "2025-07-01").
     - Use the trendSlope to guide the direction and magnitude of predictions.
     - If seasonality is present, incorporate periodic patterns (e.g., spikes every 3 months).
     - Keep predicted values within realistic bounds (min: ${stats.min}, max: ${stats.max}) unless trendSlope suggests a breakout.
  2. **Handle Variability**:
     - Use variance (${stats.variance}) to adjust prediction confidence; high variance indicates more uncertainty, so smooth predictions.
     - Downweight outliers (${JSON.stringify(outliers)}) to avoid skewing forecasts.
  3. **Handle Sparsity**:
     - If sparsity (${sparsity}) is high (>0.3), rely more on trendSlope and avg for predictions, as data may be unreliable.
  4. **Business Alignment**:
     - Ensure predictions are practical for ticket resolution (e.g., non-negative values, feasible growth rates).
     - If trendSlope is near zero, predict stable values close to avg (${stats.avg}).
  5. **Edge Cases**:
     - If data has < 3 points, return conservative predictions based on avg and trendSlope.
     - If dates are irregular, interpolate missing months before forecasting.
  6. **Output**:
     - Return only valid JSON: [{ date: string, value: number }, ...].
     - Ensure dates are in "YYYY-MM-DD" format and values are numbers (no strings or nulls).
  
- All descriptions must be concise and client-friendly. Avoid detailed analysis or technical language.
- Describe only what is essential for decision-making — like value trends, spikes, or clear takeaways.

  **Example Output**:
   {
    "forecast":
    [
      { "date": "2025-07-01", "value": 150 },
      { "date": "2025-08-01", "value": 155 },
      { "date": "2025-09-01", "value": 160 }
    ],
    "descriptions":"string"
   }
  `;
  const apiKey = process.env.OPENAI_API_KEY;
  const client = new OpenAI({
    baseURL: "https://models.github.ai/inference",
    apiKey: apiKey,
  });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Forecast the next ${forecastPeriods} values for ${field}.` },
  ];

  try {
    const response = await client.chat.completions.create({
      model: "openai/gpt-4.1-mini", // Adjust model as needed
      messages,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return { error: "No content returned from OpenAI" };
    }

    // Parse and validate response
    const cleaned = content
      .trim()
      .replace(/^```json/, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    try {
      const forecast: any = JSON.parse(cleaned) as Array<{ date: string; value: number }>;
      if (!Array.isArray(forecast.forecast) || forecast.forecast.some((item: any) => !item.date || typeof item.value !== "number")) {
        return { error: "Invalid forecast format from OpenAI" };
      }
      return forecast;
    } catch (e) {
      console.error("Parse error:", cleaned, e);
      return { error: "Failed to parse OpenAI response as JSON" };
    }
  } catch (e) {
    console.error("OpenAI API call failed:", (e as Error).message);
    return { error: `API call failed: ${(e as Error).message}` };
  }
}

async function _generateDynamicInsights(
  userIntent: string,
  dataFindings: any
): Promise<AnalysisPlan | { error: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { error: "Missing OPENAI_API_KEY environment variable" };
  }

  const client = new OpenAI({
    baseURL: "https://models.github.ai/inference",
    apiKey,
  });

  const systemPrompt = `
  You are an AI business analyst. Based on the user intent and summarized dataset below, generate the following:
  
  - keyFindings: actionable insights such as trends, aggregations, anomalies, etc.
  - businessImplications: explain what these insights mean for the business.
  - recommendedActions: specific actions the business should consider.
  - visualizationStrategies: suggest visualizations using only the provided component list.
  
  Component List:
  ${JSON.stringify(componentList, null, 2)}
  
  Choose the most suitable component from the list based on the data characteristics and user intent.
  - Use KpiCard or GaugeChart for single values (e.g., totals, percentages).
  - Use LineChart for time-based data (trends).
  - Use BarChart for categorical comparisons (e.g., counts per category).
  Do not invent components or use anything not listed.  
  
  User Intent:
  ${userIntent}

  businessContext:
  ${JSON.stringify(dataFindings.businessContext, null, 2)}
  
  anomalies:
  ${JSON.stringify(dataFindings.anomalies, null, 2)}
  
  relationships:
  ${JSON.stringify(dataFindings.relationships, null, 2)}
 
  patterns:
  ${JSON.stringify(dataFindings.patterns, null, 2)}
 
  Data Summary:
  ${JSON.stringify(dataFindings.metrics, null, 2)}
  
  You must return your response ONLY as valid JSON, exactly in this format:
  {
    "keyFindings": [...],
    "businessImplications": [...],
    "recommendedActions": [...],
    "visualizationStrategies": [
      {
        "component": string,
        "description": string,
        "inputs": {
          // For KPI visualizations:
          "value"?: number,
          "label"?: string,
  
          // For time-series or category-based charts:
          "xValues"?: [array of actual x-axis values],
          "yValues"?: [array of corresponding y-axis values]
        }
      }
    ]
  }
  
  STRICT RULES:
  - For KPI-style visualizations (e.g., KpiCard), include ONLY 'value' and 'label' inside 'inputs'.
  - For charts (e.g., LineChart, BarChart), use 'xValues' and 'yValues' inside 'inputs'.
  - DO NOT return field names like "xField": "date" — use actual extracted values like xValues = ["2025-06-01", ...].
  - DO NOT place 'value' or 'label' outside the 'inputs' block.
  - DO NOT include markdown, extra text, or explanations — respond with raw JSON only.
  - Ensure the response is directly parseable with JSON.parse() without modification.
  `.trim();


  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  try {
    const response = await client.chat.completions.create({
      model: "openai/gpt-4.1-mini",
      messages,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return { error: "No content returned from LLM" };
    }

    const cleaned = content
      .trim()
      .replace(/^```json/, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned);

      if (!isValidAnalysisPlan(parsed)) {
        return { error: "Parsed response missing expected fields" };
      }

      return parsed;
    } catch (e) {
      console.error("Parse error:", cleaned);
      return { error: "Failed to parse JSON from LLM" };
    }
  } catch (e) {
    console.error("LLM API call error:", e);
    return { error: "API call failed: " + (e as Error).message };
  }
}
export async function runAgent(userInput: string): Promise<{ action: string; action_input: any }> {
  try {
    UserInput = userInput;
    if (!userInput || typeof userInput !== "string") {
      throw new Error("Invalid user input: must be a non-empty string");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const client = new OpenAI({
      baseURL: "https://models.github.ai/inference",
      apiKey: apiKey,
    });

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: DYNAMIC_SYSTEM_PROMPT },
      { role: "user", content: userInput },
    ];
    let analysisResults: AnalysisResults = {};

    let hasMoreToolCalls = true;
    let iteration = 0;
    const maxIterations = 3;

    while (hasMoreToolCalls && iteration < maxIterations) {
      iteration++;
      const response = await client.chat.completions.create({
        model: "openai/gpt-4.1-mini",
        messages,
        tools,
        tool_choice: "auto",
      });

      const responseMessage = response.choices[0].message;
      messages.push(responseMessage);

      if (!responseMessage.tool_calls?.length) {
        hasMoreToolCalls = false;
        break;
      }

      for (const toolCall of responseMessage.tool_calls) {
        let args: any;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error(`Failed to parse tool call arguments: ${(parseError as Error).message}`);
          continue;
        }

        let toolResult: any = {};
        switch (toolCall.function.name) {
          case "analyzeDynamically":

            toolResult = await analyzeDynamically(args.focusAreas, userInput, args.analysisDepth || "detailed", args.targetFields || []);
            analysisResults.dataAnalysis = toolResult;
            break;
          case "inferFieldMeanings":
            toolResult = inferFieldMeanings(args.fields);
            analysisResults.fieldSemantics = toolResult;
            break;
          case "generateDynamicInsights":
            if (!args.dataFindings && analysisResults.dataAnalysis?.metrics) {
              args.dataFindings = analysisResults.dataAnalysis;
            }
            if (!args.dataFindings) {
              toolResult = { error: "Missing dataFindings; run analyzeDynamically first" };
            } else {
              toolResult = await generateDynamicInsights(args.userIntent, args.dataFindings);
              analysisResults.insights = toolResult;
            }
            break;
          case "buildDeveloperResponse":
            return buildDeveloperResponse(analysisResults.insights);
          default:
            console.warn(`Unknown tool function: ${toolCall.function.name}`);
            continue;
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      if (analysisResults.insights?.visualizationStrategies?.length) {
        const recommendations = analysisResults.insights.visualizationStrategies.map((s) => ({
          componentType: s.component,
          purpose: s.purpose,
          dataMapping: s.dataMapping,
          configuration: s.configuration,
        }));
        return buildDeveloperResponse(analysisResults.insights);
      }
    }

    return buildFallbackResponse(analysisResults, userInput);
  } catch (error) {
    console.error("Error in runAgent:", (error as Error).message);
    return {
      action: "Error",
      action_input: { message: `Failed to process request: ${(error as Error).message}` },
    };
  }
}

async function analyzeDynamically(
  focusAreas: string[],
  userPrompt: string,
  depth: string,
  targetFields: string[] = []
): Promise<any> {
  if (!Array.isArray(sourceData?.attributes) || sourceData.attributes.length === 0) {
    return { error: "Invalid or empty data source" };
  }

  const data: DataRecord[] = sourceData.attributes;
  const fields = Object.keys(data[0] || {});
  const fieldTypes: Record<string, any> = {};
  const fieldStats: Record<string, any> = {};
  const metrics: Record<string, any> = {};
  const timeSeries: Record<string, any> = {};
  const predictions: Record<string, any> = {};

  // Detect types and compute stats
  fields.forEach((field) => {
    const values = data.map((row) => row[field]).filter((v) => v !== undefined && v !== null);
    const uniqueValues = [...new Set(values)];

    const isNumeric = values.every((v) => typeof v === "number" && !isNaN(v));
    const isBoolean = uniqueValues.length <= 2 && uniqueValues.every((v) => v === 0 || v === 1);
    const isIdentifier = field.toLowerCase().includes("id") || field.toLowerCase().includes("number");
    const isCategorical = !isNumeric && uniqueValues.length < values.length * 0.5;
    const isTemporal = field.toLowerCase().includes("date") || field.toLowerCase().includes("time");

    fieldTypes[field] = {
      type: isNumeric ? "numeric" : isCategorical ? "categorical" : isTemporal ? "temporal" : "text",
      isIdentifier,
      isBoolean,
      isTemporal,
      uniqueCount: uniqueValues.length,
      totalCount: values.length,
      sparsity: (data.length - values.length) / data.length,
    };

    if (isNumeric && (targetFields.includes(field) || targetFields.length === 0)) {
      fieldStats[field] = {
        min: values.length ? Math.min(...(values as number[])) : 0,
        max: values.length ? Math.max(...(values as number[])) : 0,
        avg: values.length ? (values as number[]).reduce((a, b) => a + b, 0) / values.length : 0,
        sum: values.length ? (values as number[]).reduce((a, b) => a + b, 0) : 0,
        variance: values.length ? variance(values as number[]) : 0,
      };
    } else if (isTemporal) {
      timeSeries[field] = data.map((row) => ({ date: row[field], values: row }));
    } else {
      fieldStats[field] = {
        distribution: distribution(values),
        mostCommon: values.length ? mostCommon(values) : null,
      };
    }
  });

  const defaultFields = targetFields;
  const validFields = targetFields.filter(
    (field) => fields.includes(field) && fieldTypes[field].type === "numeric"
  );
  const analysisFields = validFields.length > 0 ? validFields : Object.keys(fieldStats);

  const plan = await callAIToGeneratePlan(focusAreas, userPrompt, fieldTypes);
  // predictTrends

  if (!plan || Object.keys(plan).length === 0) {
    analysisFields.forEach((field) => {
      metrics[field] = { error: `Unsupported focus areas: ${focusAreas.join(", ")}` };
    });
  } else {
    for (const [area, config] of Object.entries(plan)) {
      const targetMetrics = config.metrics || [];
      const dateField = config.dateField;

      for (const field of analysisFields) {
        if (!fieldTypes[field] || fieldTypes[field].type !== "numeric") {
          metrics[field] = { error: `Field ${field} is missing or non-numeric` };
          continue;
        }

        metrics[field] = metrics[field] || {};

        for (const metric of targetMetrics) {
          if (depth === "basic" && metric === "time_series") continue;

          switch (metric) {
            case "sum":
              metrics[field].total = fieldStats[field]?.sum || 0;
              break;
            case "avg":
              metrics[field].average = fieldStats[field]?.avg || 0;
              break;
            case "time_series":
              if (dateField && data) {
                metrics[field].trend = data
                  .sort((a, b) => {
                    const dateA = a[dateField] ? new Date(a[dateField] as string).getTime() : 0;
                    const dateB = b[dateField] ? new Date(b[dateField] as string).getTime() : 0;
                    return dateA - dateB;
                  })
                  .map((item) => ({
                    date: item[dateField],
                    value: item[field],
                  }));
              }
              break;
            case "ratio":
              if (
                analysisFields.length > 1 &&
                fieldStats[analysisFields[0]].sum &&
                fieldStats[analysisFields[1]].sum
              ) {
                metrics.performance_ratio =
                  (fieldStats[analysisFields[0]].sum / fieldStats[analysisFields[1]].sum) || 0;
              }
              break;
            default:
              metrics[field][metric] = { error: `Unsupported metric: ${metric}` };
          }
        }

        if (area === "trend" && dateField) {
          const forecast = await predictTrends(fieldStats[field], field, dateField, data);
          if (!("error" in forecast)) {
            predictions[field] = forecast;
          } else {
            predictions[field] = { error: forecast.error };
          }
        }
      }
    }

  }

  return {
    fieldTypes,
    fieldStats,
    metrics,
    timeSeries,
    relationships: relationships(data, fields, fieldTypes),
    patterns: patterns(data, fields, fieldTypes),
    anomalies: anomalies(data, fields, fieldStats),
    dataQuality: dataQuality(data, fields),
    businessContext: businessContext(fields, fieldTypes, data),
    predictions,
  };
}


function inferFieldMeanings(fields: string[]): any {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { error: "Invalid or empty fields array" };
  }

  const data: DataRecord[] = sourceData.attributes || [];
  const meanings: Record<string, any> = {};

  fields.forEach((field) => {
    const values = data.map((row) => row[field]).filter((v) => v !== undefined);
    const fieldLower = field.toLowerCase();

    let meaning = {
      fieldName: field,
      inferredPurpose: "",
      businessRole: "",
      visualizationSuitability: [] as string[],
    };

    const patterns = {
      identifier: ["id", "number"],
      error: ["error", "failed", "issue", "defect"],
      incident: ["incident", "ticket", "case", "resolved"],
      percentage: ["rate", "percent", "ratio"],
      performance: ["resolved", "time", "count", "efficiency"],
      priority: ["priority", "severity", "urgency"],
      temporal: ["date", "time", "timestamp"],
    };

    if (patterns.identifier.some((p) => fieldLower.includes(p))) {
      meaning.inferredPurpose = "identifier";
      meaning.businessRole = "tracking/reference";
      meaning.visualizationSuitability = ["axis", "grouping"];
    } else if (patterns.error.some((p) => fieldLower.includes(p))) {
      meaning.inferredPurpose = "error_metric";
      meaning.businessRole = "quality_indicator";
      meaning.visualizationSuitability = ["y-axis", "rate", "pie", "gauge"];
    } else if (patterns.incident.some((p) => fieldLower.includes(p))) {
      meaning.inferredPurpose = "incident_metric";
      meaning.businessRole = "incident_tracking";
      meaning.visualizationSuitability = ["y-axis", "count", "bar", "kpi_card"];
    } else if (patterns.percentage.some((p) => fieldLower.includes(p))) {
      meaning.inferredPurpose = "percentage_metric";
      meaning.businessRole = "ratio_indicator";
      meaning.visualizationSuitability = ["pie", "gauge", "donut"];
    } else if (patterns.performance.some((p) => fieldLower.includes(p))) {
      meaning.inferredPurpose = "performance_metric";
      meaning.businessRole = "efficiency_indicator";
      meaning.visualizationSuitability = ["bar", "kpi_card", "line"];
    } else if (patterns.temporal.some((p) => fieldLower.includes(p))) {
      meaning.inferredPurpose = "temporal";
      meaning.businessRole = "time_tracking";
      meaning.visualizationSuitability = ["x-axis", "timeline", "line", "area"];
    } else {
      const isSequential = values.length > 1 ? sequentialPattern(values) : false;
      const hasCategories = values.length ? [...new Set(values)].length < values.length * 0.5 : false;

      if (isSequential) {
        meaning.inferredPurpose = "sequential/temporal";
        meaning.businessRole = "progression_tracking";
        meaning.visualizationSuitability = ["x-axis", "timeline", "line"];
      } else if (hasCategories) {
        meaning.inferredPurpose = "categorical_grouping";
        meaning.businessRole = "classification";
        meaning.visualizationSuitability = ["grouping", "filtering", "pie"];
      } else {
        meaning.inferredPurpose = "measurement/metric";
        meaning.businessRole = "quantitative_indicator";
        meaning.visualizationSuitability = ["y-axis", "size", "bar"];
      }
    }

    meanings[field] = meaning;
  });

  return meanings;
}

async function generateDynamicInsights(userIntent: string, dataFindings: any) {
  if (!userIntent || !dataFindings) {
    return { error: "Invalid user intent or data findings" };
  }
  let res = await _generateDynamicInsights(userIntent, dataFindings);
  return { ...res, predictions: { ...dataFindings.predictions } };
}

function mapMetricsToDataFields(metrics: string[], dataFindings: any): Record<string, string> {
  const mappings: Record<string, string> = {};
  metrics.forEach((metric) => {
    const field = Object.keys(dataFindings.fieldTypes || {}).find(
      (f) => f.toLowerCase().includes(metric) || dataFindings.fieldTypes[f]?.inferredPurpose?.toLowerCase().includes(metric)
    );
    if (field) {
      mappings[metric] = field;
    }
  });
  return mappings;
}

function calculatePercentage(fieldMappings: Record<string, string>, dataFindings: any): { description: string; value: number } {
  const data: DataRecord[] = sourceData.attributes || [];
  let description = "No relevant numeric fields found";
  let value = 0;

  for (const [metric, field] of Object.entries(fieldMappings)) {
    if (field && dataFindings.fieldTypes[field]?.type === "numeric") {
      const total = data.length;
      const count = data.filter((row) => (row[field] as number) > 0).length;
      value = total > 0 ? (count / total) * 100 : 0;
      description = `${metric} percentage is ${value.toFixed(2)}%`;
    }
  }
  return { description, value };
}

function aggregateMetrics(fieldMappings: Record<string, string>, dataFindings: any): { description: string; value: number } {
  const data: DataRecord[] = sourceData.attributes || [];
  let description = "No relevant numeric fields found";
  let value = 0;

  for (const [metric, field] of Object.entries(fieldMappings)) {
    if (field && dataFindings.fieldTypes[field]?.type === "numeric") {
      value = data.length > 0 ? data.reduce((sum, row) => sum + ((row[field] as number) || 0), 0) : 0;
      description = `Total ${metric} is ${value.toFixed(2)}`;
    }
  }
  return { description, value };
}

function analyzeTrend(
  fieldMappings: Record<string, string>,
  dataFindings: any,
  temporalField: string
): { description: string; data: Array<{ date: string; value: number }> } {
  const data: DataRecord[] = sourceData.attributes || [];
  let description = "No trend data available";
  let trendData: Array<{ date: string; value: number }> = [];

  for (const [metric, field] of Object.entries(fieldMappings)) {
    if (field && dataFindings.fieldTypes[field]?.type === "numeric" && temporalField) {
      trendData = data
        .map((row) => ({
          date: row[temporalField] as string,
          value: (row[field] as number) || 0,
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const values = trendData.map((d) => d.value);
      const trendVal = values.length > 1 ? trend(values) : 0;
      description = `Trend for ${metric} is ${trendVal > 0 ? "increasing" : trendVal < 0 ? "decreasing" : "stable"}`;
    }
  }
  return { description, data: trendData };
}

function buildDeveloperResponse(insights: any) {
  const response = {
    message: naturalMessage(insights),
    components: [] as any[],
  };



  return {
    action: "success",
    action_input: insights,
  };
}

function buildFallbackResponse(analysisResults: AnalysisResults, userInput: string): { action: string; action_input: any } {
  const data: DataRecord[] = sourceData.attributes || [];
  const fields = data[0] ? Object.keys(data[0]) : [];
  const intentLower = userInput.toLowerCase();

  const relevantFields = fields.filter(
    (field) => intentLower.includes(field.toLowerCase()) || analysisResults.fieldSemantics?.[field]?.inferredPurpose?.toLowerCase().includes(intentLower)
  );

  const response = {
    message: `Analysis complete for ${relevantFields.length || fields.length} fields across ${data.length} records.`,
    components: [] as any[],
  };

  if (intentLower.includes("total") || intentLower.includes("performance")) {
    const numericField = relevantFields.find((f) => analysisResults.dataAnalysis?.fieldTypes?.[f]?.type === "numeric") || fields.find((f) => analysisResults.dataAnalysis?.fieldTypes?.[f]?.type === "numeric");
    if (numericField) {
      const aggResult = aggregateMetrics({ [numericField]: numericField }, analysisResults.dataAnalysis);
      const kpiComponent = componentList.find((c) => c.component.toLowerCase().includes("kpi"));
      if (kpiComponent) {
        response.components.push({
          component: kpiComponent.component,
          description: `KPI card for total ${numericField}`,
          inputs: {
            value: aggResult.value,
            label: numericField,
          },
          configuration: {
            title: `Total ${numericField}`,
            color: "#7C3AED",
            format: "number",
          },
        });
      }
    }
  } else if (intentLower.includes("over") || intentLower.includes("trend")) {
    const temporalField = fields.find((f) => analysisResults.dataAnalysis?.fieldTypes?.[f]?.isTemporal);
    const numericField = relevantFields.find((f) => analysisResults.dataAnalysis?.fieldTypes?.[f]?.type === "numeric");
    if (temporalField && numericField) {
      const trendResult = analyzeTrend({ [numericField]: numericField }, analysisResults.dataAnalysis, temporalField);
      const lineComponent = componentList.find((c) => c.component.toLowerCase().includes("line"));
      if (lineComponent) {
        response.components.push({
          component: lineComponent.component,
          description: `Line chart for ${numericField} over time`,
          inputs: {
            xField: trendResult.data.map((d: any) => d.date),
            yField: trendResult.data.map((d: any) => d.value),
          },
          configuration: {
            title: `${numericField} Trend`,
            xAxisLabel: "Date",
            yAxisLabel: numericField,
            lineColor: "#2563EB",
            type: "line",
            datasets: [
              {
                label: numericField,
                data: trendResult.data.map((d: any) => d.value),
                borderColor: "#2563EB",
                fill: false,
              },
            ],
          },
        });
      }
    }
  }

  if (!response.components.some((c) => c.component.toLowerCase().includes("table"))) {
    const barComponent = componentList.find((c) => c.component.toLowerCase().includes("bar"));
    if (barComponent && relevantFields.length) {
      response.components.push({
        component: barComponent.component,
        description: `Bar chart for ${relevantFields[0] || fields[0]} distribution`,
        inputs: {
          xField: data.map((row) => row[relevantFields[0] || fields[0]]),
          yField: "count",
        },
        configuration: {
          title: `${relevantFields[0] || fields[0]} Distribution`,
          xAxisLabel: relevantFields[0] || fields[0],
          yAxisLabel: "Count",
          type: "bar",
          datasets: [
            {
              label: relevantFields[0] || fields[0],
              data: distribution(data.map((row) => row[relevantFields[0] || fields[0]])),
              backgroundColor: "#3B82F6",
            },
          ],
        },
      });
    }
  }

  return {
    action: "success",
    action_input: response,
  };
}

function relationships(data: DataRecord[], fields: string[], fieldTypes: Record<string, any>): any[] {
  const relationships: any[] = [];
  const numericFields = fields.filter((f) => fieldTypes[f]?.type === "numeric");

  for (let i = 0; i < numericFields.length; i++) {
    for (let j = i + 1; j < numericFields.length; j++) {
      const field1 = numericFields[i];
      const field2 = numericFields[j];

      const values1 = data.map((row) => row[field1]).filter((v) => typeof v === "number" && !isNaN(v)) as number[];
      const values2 = data.map((row) => row[field2]).filter((v) => typeof v === "number" && !isNaN(v)) as number[];

      if (values1.length > 1 && values2.length > 1) {
        const corr = correlation(values1, values2);
        if (Math.abs(corr) > 0.5) {
          relationships.push({
            field1,
            field2,
            type: "correlation",
            strength: corr,
            direction: corr > 0 ? "positive" : "negative",
          });
        }
      }
    }
  }

  return relationships;
}

function patterns(data: DataRecord[], fields: string[], fieldTypes: Record<string, any>): any[] {
  const patterns: any[] = [];

  fields.forEach((field) => {
    if (fieldTypes[field]?.type === "numeric") {
      const values = data.map((row) => row[field]).filter((v) => typeof v === "number" && !isNaN(v)) as number[];
      if (values.length > 1) {
        const trendVal = trend(values);
        if (Math.abs(trendVal) > 0.3) {
          patterns.push({
            type: "trend",
            field,
            direction: trendVal > 0 ? "increasing" : "decreasing",
            strength: Math.abs(trendVal),
          });
        }
      }
    }
  });

  return patterns;
}

function anomalies(data: DataRecord[], fields: string[], fieldStats: Record<string, any>): any[] {
  const anomalies: any[] = [];

  Object.keys(fieldStats).forEach((field) => {
    const stats = fieldStats[field];
    if (stats.avg !== undefined && stats.variance !== undefined) {
      const threshold = stats.avg + 2 * Math.sqrt(stats.variance);
      data.forEach((row, index) => {
        if ((row[field] as number) > threshold) {
          anomalies.push({
            field,
            record: index,
            value: row[field],
            type: "outlier_high",
            severity: threshold > 0 ? ((row[field] as number) - threshold) / threshold : 0,
          });
        }
      });
    }
  });

  return anomalies;
}

function dataQuality(data: DataRecord[], fields: string[]): any {
  const quality = {
    completeness: {} as Record<string, number>,
    consistency: {} as Record<string, any>,
    overall: "good",
  };

  fields.forEach((field) => {
    const values = data.map((row) => row[field]);
    const nonNull = values.filter((v) => v !== undefined && v !== null);
    quality.completeness[field] = values.length > 0 ? nonNull.length / values.length : 0;
  });

  return quality;
}

function businessContext(fields: string[], fieldTypes: any, data: DataRecord[]): any {
  const context = {
    domain: "unknown",
    primaryMetrics: [] as string[],
    identifiers: [] as string[],
    categories: [] as string[],
  };

  const fieldNames = fields.join(" ").toLowerCase();
  if (fieldNames.includes("ticket") || fieldNames.includes("incident") || fieldNames.includes("resolved")) {
    context.domain = "incident_management";
  } else if (fieldNames.includes("sales") || fieldNames.includes("revenue")) {
    context.domain = "sales_analytics";
  } else if (fieldNames.includes("user") || fieldNames.includes("customer")) {
    context.domain = "customer_analytics";
  }

  fields.forEach((field) => {
    const type = fieldTypes[field];
    if (type?.isIdentifier) {
      context.identifiers.push(field);
    } else if (type?.type === "numeric" && !type?.isIdentifier) {
      context.primaryMetrics.push(field);
    } else if (type?.type === "categorical") {
      context.categories.push(field);
    }
  });

  return context;
}

function naturalMessage(insights: Insight): string {
  let message = "Analysis complete.";

  if (insights.keyFindings.length > 0) {
    message += insights.keyFindings.map((f) => f.description).join("; ") + ".";
  }

  message += " Recommended visualizations tailored to your query.";
  return message;
}

function availableComponent(componentType: string): Component | undefined {
  return componentList.find(
    (c) => c.component.toLowerCase().includes(componentType.toLowerCase()) || c.description.toLowerCase().includes(componentType.toLowerCase())
  );
}

function inputsFromData(dataMapping: any): any {
  const inputs: any = {};
  const data: DataRecord[] = sourceData.attributes || [];

  if (dataMapping.xField) {
    inputs.xField = data.map((row) => row[dataMapping.xField] || null);
  }

  if (dataMapping.yField) {
    inputs.yField = data.map((row) => row[dataMapping.yField] || null);
  }

  if (dataMapping.value !== undefined) {
    inputs.value = dataMapping.value;
  }

  if (dataMapping.label) {
    inputs.label = dataMapping.label;
  }

  if (dataMapping.max) {
    inputs.max = dataMapping.max;
  }

  if (dataMapping.data) {
    inputs.data = data;
  }

  return inputs;
}

function correlation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
}

function trend(values: number[]): number {
  if (values.length < 2) return 0;
  const indices = Array.from({ length: values.length }, (_, i) => i);
  return correlation(indices, values);
}

function variance(values: number[]): number {
  if (values.length < 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
}

function distribution(values: any[]): any {
  const distribution: Record<string, number> = {};
  values.forEach((val) => {
    distribution[val] = (distribution[val] || 0) + 1;
  });
  return distribution;
}

function mostCommon(values: any[]): string | null {
  if (!values.length) return null;
  const dist = distribution(values);
  return Object.keys(dist).reduce((a, b) => (dist[a] > dist[b] ? a : b));
}

function sequentialPattern(values: any[]): boolean {
  if (values.length < 2) return false;
  const numericValues = values.map((v) => Number(v)).filter((v) => !isNaN(v));
  if (numericValues.length < 2) return false;
  const diffs = numericValues.slice(1).map((val, i) => val - numericValues[i]);
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return diffs.every((diff) => Math.abs(diff - avgDiff) < avgDiff * 0.1);
}