from flask import Flask, request, jsonify
import time
import os

app = Flask(__name__)

@app.route('/segment', methods=['POST'])
def segment():
    print("Mock Modal Endpoint Reached")
    time.sleep(5) # Simulate processing
    return jsonify({
        "tumorVolume": 14.5,
        "location": "Parietal Lobe",
        "confidence": 92.1,
        "characteristics": {
            "enhancing": True,
            "necrotic": False,
            "edema": True,
            "margins": "Irregular"
        },
        "nearbyRegions": ["Motor Cortex"],
        "meshFiles": {
            "brain": "/meshes/brain_01.obj",
            "tumor": "/meshes/tumor_01.obj"
        }
    })

if __name__ == '__main__':
    app.run(port=8000)
