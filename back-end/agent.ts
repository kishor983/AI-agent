import OpenAI from "openai";
import dotenv from "dotenv";
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
`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "analyze_data_dynamically",
      description: "Analyzes data dynamically based on focus areas and depth",
      parameters: {
        type: "object",
        properties: {
          focusAreas: { type: "array", items: { type: "string" } },
          analysisDepth: { type: "string", enum: ["basic", "detailed"], default: "detailed" },
        },
        required: ["focusAreas"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "infer_field_semantics",
      description: "Infers semantic meanings of data fields",
      parameters: {
        type: "object",
        properties: {
          fields: { type: "array", items: { type: "string" } },
        },
        required: ["fields"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_insights_and_recommendations",
      description: "Generates insights and visualization recommendations based on user intent",
      parameters: {
        type: "object",
        properties: {
          userIntent: { type: "string" },
          dataFindings: { type: "object" },
        },
        required: ["userIntent", "dataFindings"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_component_response",
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

    const apiKey = process.env.OPENAI_API_KEY;;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const client = new OpenAI({
      baseURL: "https://models.github.ai/inference",
      apiKey:apiKey
   });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: DYNAMIC_SYSTEM_PROMPT },
      { role: "user", content: userInput },
    ];

    let analysisResults: AnalysisResults = {};
    let currentMessages = [...messages];

    let firstResponse: OpenAI.Chat.Completions.ChatCompletion;
    try {
      firstResponse = await client.chat.completions.create({
        model: "openai/gpt-4.1-mini",
        messages,
        tools,
        tool_choice: "auto"
      });
    } catch (apiError: any) {
      if (apiError.status === 401) {
        throw new Error("API authentication failed: Invalid API key.");
      } else if (apiError.status === 404) {
        throw new Error("API endpoint or model not found.");
      } else {
        throw new Error(`API request failed: ${apiError.message}`);
      }
    }

    currentMessages.push(firstResponse.choices[0].message);

    if (firstResponse.choices[0].message.tool_calls?.length) {
      for (const toolCall of firstResponse.choices[0].message.tool_calls) {
        let args: any;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error(`Failed to parse tool call arguments: ${(parseError as Error).message}`);
          continue;
        }

        let toolResult: any = {};
        switch (toolCall.function.name) {
          case "analyze_data_dynamically":
            toolResult = analyzeDynamically(args.focusAreas, args.analysisDepth || "detailed");
            analysisResults.dataAnalysis = toolResult;
            break;
          case "infer_field_semantics":
            toolResult = inferFieldMeanings(args.fields);
            analysisResults.fieldSemantics = toolResult;
            break;
          case "generate_insights_and_recommendations":
            toolResult = generateDynamicInsights(args.userIntent, args.dataFindings);
            analysisResults.insights = toolResult;
            break;
          case "build_component_response":
            return buildDeveloperResponse(args.recommendations, args.insights);
          default:
            console.warn(`Unknown tool function: ${toolCall.function.name}`);
            continue;
        }

        currentMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
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

    return buildFallbackResponse(analysisResults, userInput);
  } catch (error) {
    console.error("Error in runAgent:", (error as Error).message);
    return {
      action: "Error",
      action_input: { message: `Failed to process request: ${(error as Error).message}` },
    };
  }
}

function analyzeDynamically(focusAreas: string[], depth: string): any {
  if (!Array.isArray(sourceData?.attributes) || sourceData.attributes.length === 0) {
    return { error: "Invalid or empty data source" };
  }

  const data: DataRecord[] = sourceData.attributes;
  const fields = Object.keys(data[0] || {});
  const fieldTypes: Record<string, any> = {};
  const fieldStats: Record<string, any> = {};
  const metrics: Record<string, number> = {};
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

    if (isNumeric) {
      fieldStats[field] = {
        min: values.length ? Math.min(...(values as number[])) : 0,
        max: values.length ? Math.max(...(values as number[])) : 0,
        avg: values.length ? (values as number[]).reduce((a, b) => a + b, 0) / values.length : 0,
        sum: values.length ? (values as number[]).reduce((a, b) => a + b, 0) : 0,
        variance: values.length ? variance(values as number[]) : 0,
      };
      if (field.toLowerCase().includes("error") || field.toLowerCase().includes("failed")) {
        metrics[`${field}_percentage`] = values.length ? ((values as number[]).filter((v) => v > 0).length / values.length) * 100 : 0;
      }
    } else if (isTemporal) {
      timeSeries[field] = data.map((row) => ({ date: row[field], values: row }));
    } else {
      fieldStats[field] = {
        distribution: distribution(values),
        mostCommon: values.length ? mostCommon(values) : null,
      };
    }
  });

  focusAreas = Array.isArray(focusAreas) ? focusAreas : [];
  focusAreas.forEach((area) => {
    if (area?.toLowerCase().includes("incident") || area?.toLowerCase().includes("performance")) {
      const incidentField = fields.find((f) => f.toLowerCase().includes("incident") || f.toLowerCase().includes("ticket") || f.toLowerCase().includes("resolved"));
      if (incidentField && fieldTypes[incidentField]?.type === "numeric") {
        metrics[`${incidentField}_avg`] = fieldStats[incidentField].avg;
        metrics[`${incidentField}_total`] = fieldStats[incidentField].sum;
      }
    }
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

  const intentLower = userIntent.toLowerCase();
  const tokens = intentLower.split(/\s+/);
  const entities = {
    metrics: [] as string[],
    dimensions: [] as string[],
    operations: [] as string[],
  };

  tokens.forEach((token) => {
    if (["error", "incident", "ticket", "count", "resolved", "resolution"].includes(token)) {
      entities.metrics.push(token);
    } else if (["date", "time", "over"].includes(token)) {
      entities.dimensions.push("temporal");
    } else if (["percentage", "rate", "ratio"].includes(token)) {
      entities.operations.push("calculate_percentage");
    } else if (["performance", "efficiency", "total"].includes(token)) {
      entities.operations.push("aggregate_metrics");
    } else if (["trend", "over time"].includes(token)) {
      entities.operations.push("trend_analysis");
    } else if (["compare", "versus"].includes(token)) {
      entities.operations.push("comparison");
    }
  });

  const fieldMappings = mapMetricsToDataFields(entities.metrics, dataFindings);
  const temporalField = Object.keys(dataFindings.fieldTypes || {}).find((f) => dataFindings.fieldTypes[f].isTemporal);

  if (entities.operations.includes("aggregate_metrics")) {
    const aggResult = aggregateMetrics(fieldMappings, dataFindings);
    insights.keyFindings.push({
      type: "aggregation",
      description: aggResult.description || "No aggregation calculated",
      value: aggResult.value || 0,
    });
    const kpiComponent = componentList.find((c) => c.component.toLowerCase().includes("kpi"));
    if (kpiComponent) {
      insights.visualizationStrategies.push({
        primary: "performance_dashboard",
        component: kpiComponent.component,
        purpose: "Display total performance metrics",
        dataMapping: {
          value: aggResult.value,
          label: Object.keys(fieldMappings)[0] || "Performance",
        },
        configuration: {
          title: `Total ${Object.keys(fieldMappings)[0] || "Performance"}`,
          color: "#3B82F6",
          format: "number",
        },
      });
    }
  }

  if (entities.operations.includes("trend_analysis") && temporalField) {
    const trendResult = analyzeTrend(fieldMappings, dataFindings, temporalField);
    insights.keyFindings.push({
      type: "trend",
      description: trendResult.description || "No trend calculated",
      data: trendResult.data || [],
    });
    const lineComponent = componentList.find((c) => c.component.toLowerCase().includes("line"));
    if (lineComponent) {
      insights.visualizationStrategies.push({
        primary: "time_series_analysis",
        component: lineComponent.component,
        purpose: "Visualize performance trends over time",
        dataMapping: {
          xField: temporalField,
          yField: Object.values(fieldMappings)[0] || "resolved_count",
        },
        configuration: {
          title: `Trend for ${Object.keys(fieldMappings)[0] || "Resolved Tickets"}`,
          xAxisLabel: "Date",
          yAxisLabel: "Count",
          lineColor: "#10B981",
          type: "line",
          datasets: [
            {
              label: Object.keys(fieldMappings)[0] || "Resolved Tickets",
              data: trendResult.data.map((d: any) => d.value),
              borderColor: "#10B981",
              fill: false,
            },
          ],
        },
      });
    }
  }

  if (entities.operations.includes("calculate_percentage")) {
    const percentageResult = calculatePercentage(fieldMappings, dataFindings);
    insights.keyFindings.push({
      type: "percentage",
      description: percentageResult.description || "No percentage calculated",
      value: percentageResult.value || 0,
    });
    const gaugeComponent = componentList.find((c) => c.component.toLowerCase().includes("gauge"));
    if (gaugeComponent) {
      insights.visualizationStrategies.push({
        primary: "percentage_dashboard",
        component: gaugeComponent.component,
        purpose: "Show percentage of resolved tickets",
        dataMapping: {
          value: percentageResult.value,
          max: 100,
        },
        configuration: {
          title: `${Object.keys(fieldMappings)[0] || "Resolution"} Rate`,
          colorRange: ["#EF4444", "#FBBF24", "#10B981"],
          format: "percentage",
        },
      });
    }
  }

  if (!insights.visualizationStrategies.length) {
    const barComponent = componentList.find((c) => c.component.toLowerCase().includes("bar"));
    const data: DataRecord[] = sourceData.attributes || [];
    const fields = data[0] ? Object.keys(data[0]) : [];
    if (barComponent) {
      const defaultField = Object.values(fieldMappings)[0] || Object.keys(dataFindings.fieldTypes || {})[0] || fields[0] || "";
      insights.visualizationStrategies.push({
        primary: "exploratory_dashboard",
        component: barComponent.component,
        purpose: "Explore data distribution",
        dataMapping: {
          xField: defaultField,
          yField: "count",
        },
        configuration: {
          title: "Data Distribution",
          xAxisLabel: "Category",
          yAxisLabel: "Count",
          type: "bar",
          datasets: [
            {
              label: defaultField,
              data: distribution(data.map((row) => row[defaultField])),
              backgroundColor: "#3B82F6",
            },
          ],
        },
      });
    }
  }

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
  return Object.values(distribution);
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