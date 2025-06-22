import OpenAI from "openai";
import dotenv from "dotenv";
// Remove import assertions and rely on tsconfig.json resolveJsonModule
import componentJson from "../angular_components.json";
import sourceData from "../data/source.json";

dotenv.config();

interface Component {
  component: string;
  description: string;
  inputs: string[];
  outputs: string[];
}

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
    type: "function",
    function: {
      name: "analyzeDynamically",
      description: "Analyzes data dynamically based on focus areas (e.g., 'trend', 'performance', 'total') and optional target fields (e.g., 'resolved', 'ticket'). If no fields are specified, defaults to relevant fields like 'resolved'.",
      parameters: {
        type: "object",
        properties: {
          focusAreas: { type: "array", items: { type: "string" } },
          analysisDepth: { type: "string", enum: ["basic", "detailed"], default: "detailed" },
          targetFields: { type: "array", items: { type: "string" } },
        },
        required: ["focusAreas"],
      },
    },
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

export async function runAgent(userInput: string): Promise<{ action: string; action_input: any }> {
  try {
    if (!userInput || typeof userInput !== "string") {
      throw new Error("Invalid user input: must be a non-empty string");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const client = new OpenAI({
      baseURL: "https://models.github.ai/inference",
      apiKey:apiKey,
    });

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: DYNAMIC_SYSTEM_PROMPT },
      { role: "user", content: userInput },
    ];
    let analysisResults: AnalysisResults = {};

    let hasMoreToolCalls = true;
    let iteration = 0;
    const maxIterations = 5;

    while (hasMoreToolCalls && iteration < maxIterations) {
      iteration++;
      const response = await client.chat.completions.create({
        model: "openai/gpt-4.1",
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
            toolResult = analyzeDynamically(args.focusAreas, args.analysisDepth || "detailed", args.targetFields || []);
            analysisResults.dataAnalysis = toolResult;
            break;
          case "inferFieldMeanings":
            toolResult = inferFieldMeanings(args.fields);
            analysisResults.fieldSemantics = toolResult;
            break;
          case "generateDynamicInsights":
            if (!args.dataFindings && analysisResults.dataAnalysis?.metrics) {
              args.dataFindings = analysisResults.dataAnalysis.metrics;
            }
            if (!args.dataFindings) {
              toolResult = { error: "Missing dataFindings; run analyzeDynamically first" };
            } else {
              toolResult = generateDynamicInsights(args.userIntent, args.dataFindings);
              analysisResults.insights = toolResult;
            }
            break;
          case "buildDeveloperResponse":
            return buildDeveloperResponse(args.recommendations, args.insights);
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
        return buildDeveloperResponse(recommendations, analysisResults.insights);
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

function analyzeDynamically(focusAreas: string[], depth: string = "detailed", targetFields: string[] = []): any {
  if (!Array.isArray(sourceData?.attributes) || sourceData.attributes.length === 0) {
    return { error: "Invalid or empty data source" };
  }

  const data: DataRecord[] = sourceData.attributes;
  const fields = Object.keys(data[0] || {});
  const fieldTypes: Record<string, any> = {};
  const fieldStats: Record<string, any> = {};
  const metrics: Record<string, any> = {};
  const timeSeries: Record<string, any> = {};

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

  const defaultFields = ["resolved"];
  const validFields = targetFields.filter((field) => fields.includes(field) && fieldTypes[field].type === "numeric");
  const analysisFields = validFields.length > 0 ? validFields : defaultFields;

  focusAreas.forEach((area) => {
    const config = {
      total: { metrics: ["sum"] },
      trend: { metrics: ["time_series"], dateField: "date" },
      performance: { metrics: ["avg", "sum", "ratio"] },
    }[area.toLowerCase()];

    if (!config) {
      metrics[area] = { error: `Unsupported focus area: ${area}` };
      return;
    }

    const { metrics: targetMetrics, dateField } = config;

    analysisFields.forEach((field) => {
      if (!fieldTypes[field] || fieldTypes[field].type !== "numeric") {
        metrics[field] = { error: `Field ${field} is missing or non-numeric` };
        return;
      }

      metrics[field] = metrics[field] || {};

      targetMetrics.forEach((metric) => {
        if (depth === "basic" && metric === "time_series") {
          return;
        }

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
            if (analysisFields.length > 1 && fieldStats[analysisFields[0]] && fieldStats[analysisFields[1]]) {
              metrics.performance_ratio = (fieldStats[analysisFields[0]].sum / fieldStats[analysisFields[1]].sum) || 0;
            }
            break;
          default:
            metrics[field][metric] = { error: `Unsupported metric: ${metric}` };
        }
      });
    });
  });

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

function generateDynamicInsights(userIntent: string, dataFindings: any): Insight | { error: string } {
  if (!userIntent || !dataFindings) {
    return { error: "Invalid user intent or data findings" };
  }

  const insights: Insight = {
    keyFindings: [],
    businessImplications: [],
    recommendedActions: [],
    visualizationStrategies: [],
  };

  for (const field in dataFindings) {
    if (dataFindings[field].total) {
      insights.keyFindings.push({
        type: "aggregation",
        description: `Total count of ${field}: ${dataFindings[field].total}`,
        value: dataFindings[field].total,
      });
      const kpiComponent = componentList.find((c) => c.component.toLowerCase().includes("kpi"));
      if (kpiComponent) {
        insights.visualizationStrategies.push({
          primary: "performance_dashboard",
          component: kpiComponent.component,
          purpose: `Display total ${field} count`,
          dataMapping: {
            value: dataFindings[field].total,
            label: field,
          },
          configuration: {
            title: `Total ${field}`,
            color: "#3B82F6",
            format: "number",
          },
        });
      }
    }
  }

  for (const field in dataFindings) {
    if (dataFindings[field].trend) {
      const trendData = dataFindings[field].trend;
      const values = trendData.map((d: any) => d.value);
      const trendVal = values.length > 1 ? trend(values) : 0;
      const description = `Trend for ${field} is ${trendVal > 0 ? "increasing" : trendVal < 0 ? "decreasing" : "stable"}`;
      insights.keyFindings.push({
        type: "trend",
        description,
        data: trendData,
      });
      const lineComponent = componentList.find((c) => c.component.toLowerCase().includes("line"));
      if (lineComponent) {
        insights.visualizationStrategies.push({
          primary: "time_series_analysis",
          component: lineComponent.component,
          purpose: `Visualize ${field} trend over time`,
          dataMapping: {
            xField: "date",
            yField: field,
          },
          configuration: {
            title: `${field} Trend`,
            xAxisLabel: "Date",
            yAxisLabel: field,
            lineColor: "#10B981",
            type: "line",
            datasets: [
              {
                label: field,
                data: trendData.map((d: any) => d.value),
                borderColor: "#10B981",
                fill: false,
              },
            ],
          },
        });
      }
    }
  }

  insights.businessImplications = [
    `The trend in ${Object.keys(dataFindings)[0] || "resolved tickets"} indicates operational efficiency changes.`,
  ];
  insights.recommendedActions = [
    `Monitor ${Object.keys(dataFindings)[0] || "resolved tickets"} closely to identify bottlenecks.`,
  ];

  return insights;
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

function buildDeveloperResponse(recommendations: any[], insights: Insight): { action: string; action_input: any } {
  const response = {
    message: naturalMessage(insights),
    components: [] as any[],
  };

  recommendations.forEach((rec) => {
    const component = availableComponent(rec.componentType);
    if (component) {
      response.components.push({
        component: component.component,
        description: rec.purpose,
        inputs: inputsFromData(rec.dataMapping),
        configuration: rec.configuration,
      });
    }
  });

  return {
    action: "success",
    action_input: response,
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