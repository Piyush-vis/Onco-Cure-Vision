const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Helper for substituting variables in prompt templates
const populatePrompt = (template, data) => {
  let prompt = template;
  prompt = prompt.replace('{volume}', data.tumorVolume);
  prompt = prompt.replace('{location}', data.location);
  prompt = prompt.replace('{confidence}', data.confidence);
  
  if (data.characteristics) {
    prompt = prompt.replace('{enhancing}', data.characteristics.enhancing ? 'Yes' : 'No');
    prompt = prompt.replace('{necrotic}', data.characteristics.necrotic ? 'Yes' : 'No');
    prompt = prompt.replace('{edema}', data.characteristics.edema ? 'Yes' : 'No');
    prompt = prompt.replace('{margins}', data.characteristics.margins);
  } else {
    prompt = prompt.replace('{enhancing}', 'N/A').replace('{necrotic}', 'N/A').replace('{edema}', 'N/A').replace('{margins}', 'N/A');
  }

  if (data.nearbyRegions) {
    prompt = prompt.replace('{regions}', data.nearbyRegions.join(', '));
  } else {
    prompt = prompt.replace('{regions}', 'N/A');
  }

  return prompt;
};

// Mode Prompts
const DOCTOR_PROMPT_TEMPLATE = `As a neuroradiology AI assistant, generate a clinical report using standard medical terminology based on these tumor findings:

Tumor Volume: {volume} cm³
Location: {location}
Confidence: {confidence}%
Characteristics: 
- Enhancing: {enhancing}
- Necrotic: {necrotic}
- Edema: {edema}
- Margins: {margins}

Nearby Brain Regions: {regions}

Format the report with these sections:
1. FINDINGS: Detailed radiological description
2. IMPRESSION: Summary diagnosis
3. RECOMMENDATIONS: Clinical next steps

Use professional medical terminology suitable for neurosurgeons.`;

const PATIENT_PROMPT_TEMPLATE = `Explain the following brain tumor findings in simple, easy-to-understand language for a patient with no medical knowledge:

Tumor Volume: {volume} cm³ (compare to fruit size: a pea = 1cm³, grape = 2cm³, walnut = 4cm³, lime = 6cm³)
Location: {location}
Confidence: {confidence}%

Be reassuring but accurate. Avoid medical jargon. Explain:
- What this finding means
- Why confidence level matters
- General next steps (without giving medical advice)

Keep it compassionate and clear.`;

exports.generateReports = async (runData) => {
  try {
    const doctorPrompt = populatePrompt(DOCTOR_PROMPT_TEMPLATE, runData);
    const patientPrompt = populatePrompt(PATIENT_PROMPT_TEMPLATE, runData);

    const modelParams = {
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    }

    const doctorResult = await ai.models.generateContent({
        ...modelParams,
        contents: doctorPrompt
    });
    
    const patientResult = await ai.models.generateContent({
        ...modelParams,
        contents: patientPrompt
    });

    return {
      doctorReport: doctorResult.text,
      patientReport: patientResult.text
    };

  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
};

const TEXT_DOCTOR_PROMPT = `As a neuroradiology AI assistant, generate a highly structured clinical report based on the following transcribed text from an MRI report.
Ensure you use standard medical terminology suitable for neurosurgeons. Extract and synthesize:
1. FINDINGS: Detailed radiological description (tumor type, signs of necrosis, edema, margins).
2. IMPRESSION: Summary diagnosis and key neurological implications.
3. RECOMMENDATIONS: Clinical next steps and possible treatment pathways.

Transcribed Report Text:
"""
{text}
"""`;

const TEXT_PATIENT_PROMPT = `You are a compassionate medical AI. Explain the following transcribed MRI report in simple, easy-to-understand language for a patient with no medical knowledge.

Based on the text below, extract and clearly explain:
- The type of tumor and general location.
- Size (compare it to a familiar object if possible).
- Possible treatments or next steps commonly associated with these findings.
- Clearance or margins (whether it seems contained).

Be reassuring but accurate. Avoid medical jargon. Do NOT give direct medical advice, but explain what the doctor will likely consider next.

Transcribed Report Text:
"""
{text}
"""`;

exports.generateReportsFromText = async (pdfText) => {
  try {
    const doctorPrompt = TEXT_DOCTOR_PROMPT.replace('{text}', pdfText);
    const patientPrompt = TEXT_PATIENT_PROMPT.replace('{text}', pdfText);

    const modelParams = {
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    }

    const doctorResult = await ai.models.generateContent({
        ...modelParams,
        contents: doctorPrompt
    });
    
    const patientResult = await ai.models.generateContent({
        ...modelParams,
        contents: patientPrompt
    });

    return {
      doctorReport: doctorResult.text,
      patientReport: patientResult.text
    };

  } catch (error) {
    console.error('Gemini PDF API error:', error);
    throw error;
  }
};
