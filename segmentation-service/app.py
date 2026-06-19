"""
Flask API for the segmentation service.

Endpoints:
    GET  /health    - Check if model is loaded and GPU is available
    POST /segment   - Run segmentation on a folder of medical images
"""

from flask import Flask, request, jsonify
import os
import sys
import json
import subprocess

app = Flask(__name__)


@app.route('/health', methods=['GET'])
def health():
    """Check service health and model availability."""
    import torch
    model_path = os.path.join(os.path.dirname(__file__), 'models', 'best_model.pth')
    return jsonify({
        "status": "ok",
        "model_available": os.path.exists(model_path),
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    })


@app.route('/segment', methods=['POST'])
def segment():
    """Run segmentation pipeline on input folder."""
    data = request.json
    input_folder = data.get('input_folder')

    if not input_folder or not os.path.isdir(input_folder):
        return jsonify({"error": "Invalid input folder"}), 400

    try:
        # Step 1: Run prediction
        predict_script = os.path.join(os.path.dirname(__file__), 'predict_segmentation.py')
        result = subprocess.run(
            [sys.executable, predict_script, input_folder],
            capture_output=True, text=True, timeout=600  # 10 min timeout
        )

        if result.returncode != 0:
            return jsonify({"error": f"Segmentation failed: {result.stderr}"}), 500

        # Parse the JSON output from predict_segmentation.py
        prediction_result = None
        for line in result.stdout.strip().split('\n'):
            line = line.strip()
            if line.startswith('{'):
                try:
                    prediction_result = json.loads(line)
                except json.JSONDecodeError:
                    continue

        if not prediction_result or not prediction_result.get('success'):
            return jsonify({"error": "Segmentation produced no valid output"}), 500

        return jsonify(prediction_result)

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Segmentation timed out (10 min limit)"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(port=8000, debug=False)
