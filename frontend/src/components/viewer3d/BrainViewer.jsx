import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text, Edges, useGLTF, Center } from '@react-three/drei';
import * as THREE from 'three';
import { API_URL } from '../../utils/constants';

// Real GLTF Model imported from Node.js backend
const RealGLTFModel = ({ url, transparency }) => {
  const { scene } = useGLTF(url);
  
  // Clone scene so we don't mutate the cached one if multiple viewers
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  
  useMemo(() => {
     clonedScene.traverse((child) => {
       if (child.isMesh && child.material) {
          // Clone material so we don't accidentally mutate globally
          child.material = child.material.clone();
          child.material.transparent = true;

          // AI Tumor Highlights
          if (child.name.toLowerCase().includes('tumor') || child.name.toLowerCase().includes('seg')) {
             child.material.color.setHex(0xff3b30);
             child.material.emissive.setHex(0xff0000);
             child.material.emissiveIntensity = 0.8;
             child.material.opacity = 1.0;
             child.material.roughness = 0.2;
             child.material.metalness = 0.5;
          } else {
             // Brain / Other tissues
             child.material.opacity = transparency;
          }
       }
     });
  }, [clonedScene, transparency]);

  // Adjust position to center it reasonably
  return <primitive object={clonedScene} position={[0, 0, 0]} />;
};

// Procedural brain representation since we don't have OBJ files
const BrainMesh = ({ transparency, visibleLayers }) => {
  const brainRef = useRef();
  
  // Custom material for brain to look semi-transparent and fleshy
  const brainMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: 0x8aa6c1,
    metalness: 0.1,
    roughness: 0.8,
    transmission: 1 - transparency, // glass-like transparency
    thickness: 1.5,
    ior: 1.5,
    transparent: true,
    opacity: transparency,
    side: THREE.DoubleSide,
    depthWrite: false, // CRITICAL for seeing inside
  }), [transparency]);

  useFrame((state) => {
    // Gentle rotation
    if (brainRef.current) {
      brainRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.1;
    }
  });

  if (!visibleLayers.brain) return null;

  return (
    <group ref={brainRef}>
      <mesh material={brainMaterial} castShadow receiveShadow>
        {/* Approximating brain shape with deformed sphere */}
        <sphereGeometry args={[10, 64, 64]} />
        <Edges scale={1.01} color="white" transparent opacity={transparency * 0.5} />
      </mesh>
      
      {/* Visual cue for hemispheres splitting */}
      <mesh position={[0, 0, 0]}>
         <planeGeometry args={[20, 20]} />
         <meshBasicMaterial color={0x111111} transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

const TumorMesh = ({ scanData, visibleLayers }) => {
  if (!visibleLayers.tumor) return null;

  // Derive size/position from scanData
  const volume = scanData?.segmentationData?.tumorVolume || 12.5;
  const radius = Math.pow((volume * 3) / (4 * Math.PI), 1/3) * 1.5; // Scaled up slightly for viewing

  return (
    <group position={[2, 3, 1]}> {/* Approximate position for "Frontal Lobe" */}
      <mesh>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshPhysicalMaterial 
          color={0xff3b30} // Solid Red
          roughness={0.4}
          metalness={0.2}
          emissive={0xff3b30}
          emissiveIntensity={0.2}
          clearcoat={1.0}
        />
      </mesh>
      
      {/* Label */}
      <Text
        position={[0, radius + 1, 0]}
        fontSize={0.5}
        color="#ff3b30"
        anchorX="center"
        anchorY="middle"
        outlineColor="#000000"
        outlineWidth={0.05}
      >
        TUMOR
      </Text>
      <Text
        position={[0, radius + 0.5, 0]}
        fontSize={0.3}
        color="#ffaaaa"
        anchorX="center"
        anchorY="middle"
      >
        {volume}cm³
      </Text>
      
      {/* Pointer line */}
      <line>
         <bufferGeometry attach="geometry">
            <float32BufferAttribute attach="attributes-position" count={2} array={new Float32Array([0,0,0,  0, radius+0.5, 0])} />
         </bufferGeometry>
         <lineBasicMaterial attach="material" color={0xff3b30} />
      </line>
    </group>
  );
};

const EdemaMesh = ({ visibleLayers, scanData }) => {
    if (!visibleLayers.edema || !scanData?.segmentationData?.characteristics?.edema) return null;
    return (
        <group position={[2, 3, 1]}>
           <mesh>
               <sphereGeometry args={[4.5, 32, 32]} />
               <meshPhysicalMaterial 
                  color={0x00aaff}
                  transparent 
                  opacity={0.15}
                  roughness={0.2}
                  transmission={0.9}
                  depthWrite={false}
               />
           </mesh>
        </group>
    )
}

const BrainViewer = ({ scanData, transparency, visibleLayers }) => {
  // Post-processing for brain-like guarantee validation
  const confidence = scanData?.segmentationData?.confidence || 100;
  
  const glbPath = scanData?.meshFiles?.combined;
  const BASE_URL = API_URL.replace('/api', '');
  const glbUrl = glbPath ? `${BASE_URL}${glbPath}` : null;

  return (
    <div className="w-full h-full relative" style={{ width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 0, 150], fov: 60 }} shadows style={{ width: '100%', height: '100%' }}>
        {/* Lights */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#4f46e5" />
        
        {/* Reference Grid/Floor */}
        <ContactShadows position={[0, -11, 0]} opacity={0.4} scale={50} blur={2.5} far={15} />

        {/* Meshes */}
        <group position={[0, -2, 0]}>
            {glbUrl ? (
                <Center>
                    <RealGLTFModel url={glbUrl} transparency={transparency} />
                </Center>
            ) : (
                <>
                    <BrainMesh transparency={transparency} visibleLayers={visibleLayers} />
                    <TumorMesh scanData={scanData} visibleLayers={visibleLayers} />
                    <EdemaMesh scanData={scanData} visibleLayers={visibleLayers} />
                </>
            )}
        </group>

        
        {/* Controls */}
        <OrbitControls 
            makeDefault
            enablePan={true} 
            enableZoom={true} 
            enableRotate={true}
            autoRotate={true}
            autoRotateSpeed={0.5}
            minDistance={5}
            maxDistance={500}
            zoomSpeed={2.5}
            rotateSpeed={-0.8} 
            panSpeed={-0.8}  
        />
        <Environment preset="city" />
      </Canvas>
      
      {/* UI Overlays */}
      <div className="absolute top-4 left-4 flex flex-col space-y-2 pointer-events-none">
          <div className="bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 font-mono text-xs flex items-center shadow-lg">
              <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2 animate-pulse"></span>
              Live 3D Render
          </div>
          
          {confidence < 80 && (
              <div className="bg-yellow-500/20 backdrop-blur-md px-3 py-1.5 rounded-lg border border-yellow-500/50 font-mono text-xs text-yellow-300 shadow-lg max-w-xs">
                 ⚠️ <b>Atlas Mapping Active:</b> Low confidence ({confidence.toFixed(1)}%). Standard atlas shape applied.
              </div>
          )}
      </div>

      <div className="absolute bottom-4 left-4 bg-slate-900/60 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg text-xs font-mono text-slate-400 pointer-events-none">
          Left Click: Rotate | Right Click: Pan | Scroll: Zoom
      </div>
    </div>
  );
};

export default BrainViewer;
