import type { ImmediateRule } from "./immediate-rule-registry";

// Bank responsibility: open-topic prompts framed through service work, retail, restaurant, or practical customer scenarios.
export const OPEN_TOPIC_SERVICE_IMMEDIATE_RULES: ImmediateRule[] = [
  {
      id: "immediate:restaurant-repeat-demand",
      priority: 205,
      category: "service_admin",
      include: [/\b(restaurant|food|meal)\b/i, /\b(type|repeat demand|come back|tenants?|residents?)\b/i],
      output: "For repeat demand, I would pick reliable comfort food over something fancy: fast service, consistent taste, fair price, and food that still works for takeout or delivery.",
      reasoning: "Immediate restaurant repeat-demand answer",
      confidence: 0.88,
    },
  {
      id: "immediate:no-spend-day-budget-priority",
      priority: 170,
      category: "service_admin",
      include: [/\bbudgeting|budget\b/i, /\b(food|transport|no[- ]?spend|without money|one day without money|daily need|fixed trips)\b/i],
      exclude: [/\b(latency|integrations?|users?|ship|support flow|frustrated|product)\b/i],
      output: "I would handle food first, because it is the daily need, then plan transport around the fixed trips. After that I would set a small leftover buffer instead of pretending the whole day is free.",
      reasoning: "Immediate no-spend-day budget priority",
      confidence: 0.88,
    },
  {
      id: "immediate:park-staff-training-budget",
      priority: 165,
      category: "service_admin",
      include: [/\bpark\b/i, /\b(staff training|budget|low-cost|premium)\b/i],
      output: "Yes, I would budget for basic staff training, but keep it low-cost first: safety, maintenance, and how to handle complaints. Premium features can come later after the park actually works day to day.",
      reasoning: "Immediate park staff-training budget answer",
      confidence: 0.88,
    },
];
