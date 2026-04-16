import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  // Try to get the key from various possible sources
  // Prioritize process.env.GEMINI_API_KEY as per skill guidelines
  const key = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || 
              (import.meta as any).env.VITE_GEMINI_API_KEY || 
              '';
  
  if (key && key !== 'undefined' && key !== 'null') {
    return key;
  }
  return '';
};

const GEMINI_API_KEY = getApiKey();

if (!GEMINI_API_KEY) {
  console.warn("Gemini API Key is missing. AI features will not work until VITE_GEMINI_API_KEY is set in environment variables.");
} else {
  console.log("Gemini API Key loaded successfully.");
}

let aiInstance: GoogleGenAI | null = null;

const getAi = () => {
  if (!aiInstance) {
    const key = getApiKey();
    if (!key) {
      throw new Error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in your environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey: key });
  }
  return aiInstance;
};

export interface NutrientData {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  vitaminA: number;
  vitaminC: number;
  calcium: number;
  iron: number;
}

export interface UserProfile {
  age: number;
  gender: 'male' | 'female' | 'other';
  weight?: number;
  height?: number;
  dietaryRestrictions?: string[];
  allergies?: string[];
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  medicalConditions?: string[];
  bloodTestSummary?: string;
}

export interface FoodAnalysis {
  name: string;
  nutrients: NutrientData;
  warnings?: string[];
}

export async function analyzeFood(foodDescription: string, profile?: UserProfile): Promise<FoodAnalysis> {
  const key = getApiKey();
  if (!key) {
    throw new Error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in your environment variables.");
  }
  const dietaryContext = profile ? `
    User Profile:
    - Dietary Restrictions: ${profile.dietaryRestrictions?.join(', ') || 'None'}
    - Allergies: ${profile.allergies?.join(', ') || 'None'}
  ` : '';

  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following food item and provide its estimated nutritional content: "${foodDescription}". 
    ${dietaryContext}
    Provide values for a standard serving size. 
    Vitamins and minerals should be in percentage of Daily Value (% DV).
    If the food conflicts with the user's dietary restrictions or allergies, include specific warnings.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          nutrients: {
            type: Type.OBJECT,
            properties: {
              calories: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              carbs: { type: Type.NUMBER },
              fat: { type: Type.NUMBER },
              fiber: { type: Type.NUMBER },
              vitaminA: { type: Type.NUMBER },
              vitaminC: { type: Type.NUMBER },
              calcium: { type: Type.NUMBER },
              iron: { type: Type.NUMBER },
            },
            required: ["calories", "protein", "carbs", "fat", "fiber", "vitaminA", "vitaminC", "calcium", "iron"],
          },
          warnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["name", "nutrients"],
      },
    },
  });

  return JSON.parse(response.text);
}

export async function analyzeFoodImage(base64Image: string, profile?: UserProfile): Promise<FoodAnalysis> {
  const key = getApiKey();
  if (!key) {
    throw new Error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in your environment variables.");
  }
  const dietaryContext = profile ? `
    User Profile:
    - Dietary Restrictions: ${profile.dietaryRestrictions?.join(', ') || 'None'}
    - Allergies: ${profile.allergies?.join(', ') || 'None'}
  ` : '';

  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      },
      {
        text: `Analyze the food in this image. 
        ${dietaryContext}
        Identify the food items, estimate portions, and provide nutritional content.
        If the food conflicts with the user's dietary restrictions or allergies, include specific warnings.`
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          nutrients: {
            type: Type.OBJECT,
            properties: {
              calories: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              carbs: { type: Type.NUMBER },
              fat: { type: Type.NUMBER },
              fiber: { type: Type.NUMBER },
              vitaminA: { type: Type.NUMBER },
              vitaminC: { type: Type.NUMBER },
              calcium: { type: Type.NUMBER },
              iron: { type: Type.NUMBER },
            },
            required: ["calories", "protein", "carbs", "fat", "fiber", "vitaminA", "vitaminC", "calcium", "iron"],
          },
          warnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["name", "nutrients"],
      },
    },
  });

  return JSON.parse(response.text);
}

export async function getNutrientRecommendations(currentNutrients: NutrientData, profile: UserProfile): Promise<string> {
  const key = getApiKey();
  if (!key) {
    return "AI recommendations are unavailable because the API key is missing.";
  }
  const medicalContext = `
    Medical Context:
    - Conditions: ${profile.medicalConditions?.join(', ') || 'None'}
    - Blood Test Summary: ${profile.bloodTestSummary || 'None'}
  `;

  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on the following daily nutrient intake for a ${profile.age} year old ${profile.gender}, identify what's missing and suggest 3-5 specific foods to enhance the nutrient profile. 
    ${medicalContext}
    Incorporate principles from Canada's Food Guide:
    - Aim for half the plate to be vegetables and fruits.
    - Choose whole grain foods.
    - Eat protein foods, choosing plant-based proteins more often.
    - Make water your drink of choice.
    
    Current Intake: ${JSON.stringify(currentNutrients)}.
    Provide the response as a concise markdown list with brief explanations.`,
  });

  return response.text || "No recommendations available at this time.";
}

export async function analyzeMedicalDocument(base64Image: string): Promise<string> {
  const key = getApiKey();
  if (!key) {
    return "Document analysis is unavailable because the API key is missing.";
  }
  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      },
      {
        text: "Analyze this medical document or blood test result. Extract key findings, specifically any nutrient deficiencies or markers relevant to diet (e.g., high cholesterol, low iron, blood sugar levels). Provide a concise summary of the findings that can be used to tailor nutritional advice."
      }
    ],
  });

  return response.text || "Could not analyze the document.";
}

export async function getCanadaFoodGuideSummary(): Promise<string> {
  const key = getApiKey();
  if (!key) {
    return "Food guide information is unavailable because the API key is missing.";
  }
  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Provide a concise summary of Canada's Food Guide recommendations for each major food group:
    - Vegetables and Fruits
    - Whole Grain Foods
    - Protein Foods (including dairy and plant-based)
    - Healthy Fats
    - Water and Beverages
    
    Format the response as a clean markdown guide with bullet points for each group.`,
  });

  return response.text || "Food guide information is currently unavailable.";
}

export async function calculatePersonalizedTargets(profile: UserProfile): Promise<NutrientData> {
  const key = getApiKey();
  if (!key) {
    throw new Error("Cannot calculate targets: Gemini API Key is missing.");
  }
  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Calculate the recommended daily nutrient targets for a ${profile.age} year old ${profile.gender}. 
    Activity Level: ${profile.activityLevel || 'moderate'}.
    Dietary Restrictions: ${profile.dietaryRestrictions?.join(', ') || 'None'}.
    Provide values for calories, protein (g), carbs (g), fat (g), fiber (g), and set vitamins/minerals to 100 (% DV).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          calories: { type: Type.NUMBER },
          protein: { type: Type.NUMBER },
          carbs: { type: Type.NUMBER },
          fat: { type: Type.NUMBER },
          fiber: { type: Type.NUMBER },
          vitaminA: { type: Type.NUMBER },
          vitaminC: { type: Type.NUMBER },
          calcium: { type: Type.NUMBER },
          iron: { type: Type.NUMBER },
        },
        required: ["calories", "protein", "carbs", "fat", "fiber", "vitaminA", "vitaminC", "calcium", "iron"],
      },
    },
  });

  return JSON.parse(response.text);
}
