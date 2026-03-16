const path = require('path');

const BRAIN_REGIONS = [
  'left frontal lobe',
  'right frontal lobe',
  'left temporal lobe',
  'right temporal lobe',
  'left parietal lobe',
  'right parietal lobe',
  'left occipital lobe',
  'right occipital lobe',
  'cerebellum',
  'brainstem',
  'corpus callosum',
  'left basal ganglia',
  'right basal ganglia',
  'left thalamus',
  'right thalamus',
  'left hippocampus',
  'right hippocampus',
  'left amygdala',
  'right amygdala',
  'pituitary gland'
];

const MARGIN_TYPES = ['smooth', 'irregular', 'infiltrative'];

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Generate a bounded random float between min and max with given decimals
const randFloat = (min, max, decimals = 2) => {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
};

exports.generateMockSegmentation = async (filePath) => {
  // filePath is unused in the mock, but kept for future compatibility
  const volume = randFloat(0.5, 8.0, 2); // cm³
  const confidence = Math.floor(randFloat(75, 98, 0));

  const tumorData = {
    volume,
    location: pickRandom(BRAIN_REGIONS),
    confidence,
    characteristics: {
      enhancing: Math.random() < 0.7,
      necrotic: Math.random() < 0.3,
      edema: Math.random() < 0.6,
      margins: pickRandom(MARGIN_TYPES),
    },
    coordinates: {
      x: randFloat(0.1, 0.9, 2),
      y: randFloat(0.1, 0.9, 2),
      z: randFloat(0.1, 0.9, 2),
    },
  };

  const meshBase =
    process.env.MOCK_MESH_BASE_URL ||
    'https://storage.googleapis.com/mocks';

  const meshUrls = {
    brain: `${meshBase}/standard_brain.obj`,
    tumor: `${meshBase}/tumor_sphere.obj`,
  };

  return {
    success: true,
    tumorData,
    meshUrls,
  };
};

