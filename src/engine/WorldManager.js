import { seedStringToNumber } from '../utils/prng';
import WorkerPool from './WorkerPool';

function fract(x) {
  return x - Math.floor(x);
}

function hash2(x, y, seedNum) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seedNum * 101.7) * 43758.5453123;
  return fract(s);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x, y, seedNum = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = x - x0;
  const sy = y - y0;
  const n00 = hash2(x0, y0, seedNum);
  const n10 = hash2(x0 + 1, y0, seedNum);
  const n01 = hash2(x0, y0 + 1, seedNum);
  const n11 = hash2(x0 + 1, y0 + 1, seedNum);
  const ix0 = lerp(n00, n10, fade(sx));
  const ix1 = lerp(n01, n11, fade(sx));
  return lerp(ix0, ix1, fade(sy));
}

function fractalNoise2D(x, y, seedNum = 0, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let freq = 1,
    amp = 1,
    sum = 0,
    max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq, seedNum + i * 1000) * amp;
    max += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return max === 0 ? 0 : sum / max;
}

function ridgeNoise(x, y, seedNum) {
  return 1 - Math.abs(fractalNoise2D(x, y, seedNum, 1) * 2 - 1);
}

export default class WorldManager {
  constructor({
    chunkSize = 16,
    tileSize = 32,
    seed = 'nit-trichy-cse-2028',
    noiseConfig = {},
    poolOptions = {},
  } = {}) {
    this.chunkSize = chunkSize;
    this.tileSize = tileSize;
    this.seed = seed;
    this.seedNum = seedStringToNumber(seed);
    this.chunks = new Map();
    this.collisionMap = new Map();
    this.treeEntities = new Map();

    this.noiseConfig = {
      scale: 0.015, 
      octaves: 5,
      lacunarity: 2.1,
      gain: 0.45,
      heightWeight: 1.2,
      moistureWeight: 0.8,
      temperatureWeight: 0.6,
      ...noiseConfig,
    };

    this.viewRadius = 4;
    this.generationQueue = new Map();
    this._generationId = 0;

    this.pool = null;
    this._initPool(poolOptions);
  }

  _initPool(poolOptions = {}) {
    try {
      const workerURL = new URL('../workers/chunkWorker.js', import.meta.url);
      this.pool = new WorkerPool(workerURL, {
        workers: poolOptions.workers || Math.max(1, (navigator.hardwareConcurrency || 4) - 1),
        jobTimeoutMs: poolOptions.jobTimeoutMs || 15000,
        verbose: !!poolOptions.verbose,
      });
      console.log(`[WorldManager] WorkerPool initialized with ${this.pool.maxWorkers} workers`);
    } catch (err) {
      console.warn(
        '[WorldManager] WorkerPool initialization failed, using synchronous generation',
        err
      );
      this.pool = null;
    }
  }

  getPoolStats() {
    if (!this.pool) {
      return {
        hw: navigator.hardwareConcurrency || 4,
        maxWorkers: 0,
        idleWorkers: 0,
        queuedJobs: 0,
        pendingJobs: 0,
        activeJobs: 0,
      };
    }
    return this.pool.getStats();
  }

  setPoolSize(n) {
    if (!this.pool) {
      this._initPool({ workers: n, verbose: true, jobTimeoutMs: 15000 });
    } else {
      this.pool.resize(Math.max(1, n));
    }
  }

  _key(cx, cy) {
    return `${cx},${cy}`;
  }

  setSeed(seed) {
    this.seed = seed;
    this.seedNum = seedStringToNumber(seed);
    this.chunks.clear();
    this.generationQueue.clear();
  }

  setNoiseConfig(cfg) {
    this.noiseConfig = { ...this.noiseConfig, ...cfg };
    this.chunks.clear();
    this.generationQueue.clear();
  }

  _drawTile(ctx, tx, ty, tileType, tilePx, biomeData = {}) {
    const x = tx * tilePx;
    const y = ty * tilePx;

    const colors = {
      deepOcean: '#0a1e3a',
      ocean: '#1a3a6a',
      shallowWater: '#2a5a9a',

      beach: '#f0e6b4',
      wetSand: '#e8d8a8',

      grass: '#5a9e5a',
      lushGrass: '#4a8e4a',
      dryGrass: '#6aae6a',

      forest: '#3a7a3a',
      denseForest: '#2a6a2a',
      autumnForest: '#8a6a3a',

      dirt: '#8b7355',
      dryDirt: '#9b8365',
      crackedEarth: '#a59375',

      mountain: '#7a7a7a',
      highMountain: '#8a8a8a',
      snowCap: '#e8e8e8',

      road: '#5a5a5a',
      building: '#3a3a3a',
      ruin: '#4a4a4a',
    };

    let baseColor = colors.grass;
    let texturePattern = null;

    switch (tileType) {
      case 0: 
        baseColor = colors.deepOcean;
        texturePattern = 'waves';
        break;
      case 1: 
        baseColor = colors.ocean;
        texturePattern = 'waves';
        break;
      case 2: 
        baseColor = colors.shallowWater;
        texturePattern = 'ripples';
        break;
      case 3:
        baseColor = colors.beach;
        texturePattern = 'sand';
        break;
      case 4: 
        baseColor =
          biomeData.moisture > 0.7
            ? colors.lushGrass
            : biomeData.moisture < 0.3
            ? colors.dryGrass
            : colors.grass;
        texturePattern = 'grass';
        break;
      case 5: 
        baseColor = biomeData.temperature > 0.7 ? colors.autumnForest : colors.forest;
        texturePattern = 'forest';
        break;
      case 6: 
        baseColor = colors.dirt;
        texturePattern = 'dirt';
        break;
      case 7: 
        baseColor = colors.mountain;
        texturePattern = 'rock';
        break;
      case 8:
        baseColor = colors.snowCap;
        texturePattern = 'snow';
        break;
      case 9: 
        baseColor = colors.road;
        texturePattern = 'road';
        break;
      case 10: 
        baseColor = colors.building;
        texturePattern = 'building';
        break;
      case 11: 
        baseColor = colors.ruin;
        texturePattern = 'ruin';
        break;
    }

    ctx.fillStyle = baseColor;
    ctx.fillRect(x, y, tilePx, tilePx);

    this._applyTexture(ctx, x, y, tilePx, texturePattern, biomeData);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, tilePx, tilePx);
  }

  _applyTexture(ctx, x, y, size, pattern, biomeData) {
    ctx.save();

    switch (pattern) {
      case 'waves':
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        for (let i = 0; i < 2; i++) {
          const waveY = y + size * 0.7 + Math.sin(x * 0.1) * 2;
          ctx.fillRect(x + 2, waveY, size - 4, 1);
        }
        break;

      case 'ripples':
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'sand':
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(
            x + 2 + Math.random() * (size - 4),
            y + 2 + Math.random() * (size - 4),
            1,
            1
          );
        }
        break;

      case 'grass':
        ctx.fillStyle = 'rgba(106, 190, 106, 0.2)';
        if ((x + y) % 4 === 0) {
          ctx.fillRect(x + 4, y + 4, size - 8, 1);
        }
        break;

      case 'forest':
        ctx.fillStyle = 'rgba(40, 100, 40, 0.3)';
        ctx.fillRect(x, y, size, size);
        break;

      case 'dirt':
        ctx.fillStyle = 'rgba(101, 67, 33, 0.15)';
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(
            x + 2 + Math.random() * (size - 4),
            y + 2 + Math.random() * (size - 4),
            1,
            1
          );
        }
        break;

      case 'rock':
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        if ((x * y) % 7 === 0) {
          ctx.fillRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4);
        }
        break;

      case 'snow':
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        for (let i = 0; i < 2; i++) {
          ctx.fillRect(
            x + 2 + Math.random() * (size - 4),
            y + 2 + Math.random() * (size - 4),
            2,
            2
          );
        }
        break;

      case 'road':
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x + size * 0.4, y + 2, size * 0.2, size - 4);
        break;
    }

    ctx.restore();
  }
  _drawTree(ctx, x, y, size, treeType = 'oak', age = 1) {
    const trunkHeight = size * 1.2 * age; 
    const canopySize = size * 1.4 * age; 
    ctx.save();

    ctx.fillStyle = treeType === 'pine' ? '#5d4037' : treeType === 'birch' ? '#d7ccc8' : '#8d6e63';

    switch (treeType) {
      case 'pine':
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.moveTo(x, y - trunkHeight - canopySize);
        ctx.lineTo(x - canopySize / 1.8, y - trunkHeight); 
        ctx.lineTo(x + canopySize / 1.8, y - trunkHeight); 
        ctx.closePath();
        ctx.fill();
        break;

      case 'birch':
        ctx.fillStyle = '#a5d6a7';
        ctx.beginPath();
        ctx.arc(x, y - trunkHeight - canopySize / 2.5, canopySize / 1.8, 0, Math.PI * 2); 
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5; 
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(x - size * 0.08, y - trunkHeight + i * 10);
          ctx.lineTo(x + size * 0.08, y - trunkHeight + i * 10);
          ctx.stroke();
        }
        break;

      default:
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.arc(x, y - trunkHeight - canopySize / 2.5, canopySize / 1.8, 0, Math.PI * 2); 
        ctx.fill();
        break;
    }

    ctx.restore();

    return {
      width: canopySize,
      height: trunkHeight + canopySize,
      type: 'tree',
    };
  }

  _drawBuilding(ctx, x, y, width, height, style = 'medieval', condition = 1) {
    ctx.save();

    const isRuined = condition < 0.3;
    const baseColor = isRuined ? '#5d4037' : style === 'modern' ? '#37474f' : '#5d4037';

    ctx.fillStyle = baseColor;
    ctx.fillRect(x - width / 2, y - height, width, height);

    if (!isRuined) {
      ctx.fillStyle = style === 'modern' ? '#455a64' : '#d32f2f';
      if (style === 'medieval') {
        ctx.beginPath();
        ctx.moveTo(x - width / 2, y - height);
        ctx.lineTo(x + width / 2, y - height);
        ctx.lineTo(x, y - height - width / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x - width / 2 - 2, y - height - 5, width + 4, 5);
      }

      ctx.fillStyle = '#5d4037';
      ctx.fillRect(x - 3, y - 10, 6, 10);

      ctx.fillStyle = style === 'modern' ? '#81d4fa' : '#ffeb3b';
      if (style === 'medieval') {
        ctx.fillRect(x - width / 2 + 5, y - height + 15, 4, 4);
        ctx.fillRect(x + width / 2 - 9, y - height + 15, 4, 4);
      } else {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            ctx.fillRect(x - width / 2 + 8 + i * 8, y - height + 15 + j * 12, 4, 4);
          }
        }
      }
    } else {
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(x - width / 2, y - height, width, height * 0.3);

      ctx.fillStyle = '#6d4c41';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x - width / 2 + i * (width / 3), y - height * 0.7, width / 4, height * 0.4);
      }
    }

    ctx.restore();
  }

  _createCanvasForTiles(cx, cy, tiles, biomeData) {
    const size = this.chunkSize;
    const tilePx = this.tileSize;
    const canv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!canv) return null;

    canv.width = size * tilePx;
    canv.height = size * tilePx;
    const ctx = canv.getContext('2d');

    if (!tiles || !biomeData) {
      const generated = this._generateChunkData(cx, cy);
      tiles = generated.tiles;
      biomeData = generated.biomeData;
    }

    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const idx = ty * size + tx;
        const tileBiome = {
          height: biomeData.height[idx],
          moisture: biomeData.moisture[idx],
          temperature: biomeData.temperature[idx],
        };
        this._drawTile(ctx, tx, ty, tiles[idx], tilePx, tileBiome);
      }
    }

    this._decorateChunk(ctx, cx, cy, tiles, biomeData, tilePx);

    return { canvas: canv, tiles, biomeData };
  }

  _generateChunkData(cx, cy) {
    const size = this.chunkSize;
    const tiles = new Uint8Array(size * size);
    const heightMap = new Float32Array(size * size);
    const moistureMap = new Float32Array(size * size);
    const temperatureMap = new Float32Array(size * size);

    const scale = this.noiseConfig.scale;
    const octaves = this.noiseConfig.octaves;

    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const worldX = cx * size + tx;
        const worldY = cy * size + ty;
        const idx = ty * size + tx;

        const height =
          fractalNoise2D(
            worldX * scale,
            worldY * scale,
            this.seedNum,
            octaves,
            this.noiseConfig.lacunarity,
            this.noiseConfig.gain
          ) * this.noiseConfig.heightWeight;

        const moisture =
          fractalNoise2D(
            worldX * scale * 1.3,
            worldY * scale * 1.3,
            this.seedNum + 1000,
            octaves - 1
          ) * this.noiseConfig.moistureWeight;

        const temperature =
          fractalNoise2D(
            worldX * scale * 0.8,
            worldY * scale * 0.8,
            this.seedNum + 2000,
            octaves - 1
          ) * this.noiseConfig.temperatureWeight;

        const ridge = ridgeNoise(worldX * scale * 0.5, worldY * scale * 0.5, this.seedNum + 3000);

        heightMap[idx] = height;
        moistureMap[idx] = moisture;
        temperatureMap[idx] = temperature;

        let tileType = 4;

        if (height < 0.12) {
          tileType = height < 0.06 ? 0 : height < 0.09 ? 1 : 2;
        } else if (height < 0.16) {
          tileType = 3; 
        } else if (height < 0.65) {
          if (moisture > 0.7) {
            tileType = 5; 
          } else if (moisture < 0.3) {
            tileType = 6; 
          } else {
            tileType = 4; 
          }
        } else if (height < 0.82) {
          if (ridge > 0.6) {
            tileType = 7;
          } else {
            tileType = temperature > 0.6 ? 6 : 4;
          }
        } else {
          tileType = height > 0.88 ? 8 : 7;
        }

        const featureNoise = fractalNoise2D(
          worldX * scale * 4,
          worldY * scale * 4,
          this.seedNum + 4000,
          2
        );

        if (
          featureNoise > 0.65 &&
          featureNoise < 0.67 &&
          height > 0.3 &&
          height < 0.6 &&
          moisture > 0.4
        ) {
          tileType = 9; 
        } else if (featureNoise > 0.75 && height > 0.35 && height < 0.5) {
          tileType = temperature > 0.5 ? 10 : 11; 
        }

        tiles[idx] = tileType;
      }
    }

    return {
      tiles,
      biomeData: {
        height: heightMap,
        moisture: moistureMap,
        temperature: temperatureMap,
      },
    };
  }
  _decorateChunk(ctx, cx, cy, tiles, biomeData, tilePx) {
    const size = this.chunkSize;
    const rng = this._createChunkRNG(cx, cy);
    const chunkKey = this._key(cx, cy);
    const chunkTrees = [];

    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const idx = ty * size + tx;
        const tileType = tiles[idx];
        const featureRoll = rng();

        switch (tileType) {
          case 5: 
            if (featureRoll < 0.3) {
              const treeType = featureRoll < 0.1 ? 'pine' : featureRoll < 0.2 ? 'birch' : 'oak';
              const localX = tx * tilePx + tilePx / 2;
              const localY = ty * tilePx + tilePx / 2;
              const worldTreeX = cx * this.chunkSize * tilePx + localX;
              const worldTreeY = cy * this.chunkSize * tilePx + localY;

              const treeCollision = this._drawTree(
                ctx,
                localX,
                localY,
                tilePx * 1.1,
                treeType,
                0.8 + featureRoll * 0.4
              );
              chunkTrees.push({
                ...treeCollision,
                x: worldTreeX,
                y: worldTreeY,
                id: `${chunkKey}_tree_${tx}_${ty}`,
                type: 'tree',
                collisionRadius: Math.max(treeCollision.width, treeCollision.height) * 0.4,
              });
            }
            break;

          case 4: 
            if (featureRoll < 0.05 && biomeData.moisture[idx] > 0.5) {
              const localX = tx * tilePx + tilePx / 2;
              const localY = ty * tilePx + tilePx / 2;
              const worldTreeX = cx * this.chunkSize * tilePx + localX;
              const worldTreeY = cy * this.chunkSize * tilePx + localY;

              const treeCollision = this._drawTree(
                ctx,
                localX,
                localY,
                tilePx * 0.9,
                'oak',
                0.6 + featureRoll
              );
              chunkTrees.push({
                ...treeCollision,
                x: worldTreeX,
                y: worldTreeY,
                id: `${chunkKey}_tree_${tx}_${ty}`,
                type: 'tree',
                collisionRadius: Math.max(treeCollision.width, treeCollision.height) * 0.4,
              });
            }
            break;

          case 10: {
            const buildingStyle = featureRoll < 0.5 ? 'medieval' : 'modern';
            const condition = 0.3 + featureRoll * 0.7;
            this._drawBuilding(
              ctx,
              tx * tilePx + tilePx / 2,
              ty * tilePx + tilePx / 2,
              tilePx * (buildingStyle === 'modern' ? 0.9 : 0.7),
              tilePx * (buildingStyle === 'modern' ? 1.2 : 0.8),
              buildingStyle,
              condition
            );
            break;
          }
          case 11:
            this._drawBuilding(
              ctx,
              tx * tilePx + tilePx / 2,
              ty * tilePx + tilePx / 2,
              tilePx * 0.8,
              tilePx * 0.6,
              'medieval',
              0.2 + featureRoll * 0.3
            );
            break;
        }
      }
    }

    const treeCollisions = chunkTrees.filter((obj) => obj.type === 'tree');
    this.collisionMap.set(chunkKey, treeCollisions);
    return chunkTrees;
  }

  _createChunkRNG(cx, cy) {
    const seed = this.seedNum + cx * 131 + cy * 197;
    let state = seed;
    return () => {
      state = Math.imul(state, 1597334677) | 0;
      state = Math.imul(state, 1597334677) | 0;
      return (state & 0x7fffffff) / 0x7fffffff;
    };
  }

  _postProcessGeneratedChunk(cx, cy, data) {
    const rendered = this._createCanvasForTiles(cx, cy, data?.tiles, data?.biomeData);
    return {
      cx,
      cy,
      tiles: data?.tiles || new Uint8Array(this.chunkSize * this.chunkSize),
      biomeData: data?.biomeData || {},
      generatedAt: Date.now(),
      canvas: rendered ? rendered.canvas : null,
      _generationId: this._generationId++,
    };
  }

  async _generateChunkAsync(cx, cy) {
    const key = this._key(cx, cy);

    if (this.generationQueue.has(key)) {
      return this.generationQueue.get(key);
    }

    if (this.chunks.has(key)) {
      const existing = this.chunks.get(key);
      if (existing.canvas) return existing;
    }

    if (this.pool) {
      try {
        const generationPromise = (async () => {
          const args = {
            cx,
            cy,
            chunkSize: this.chunkSize,
            tileSize: this.tileSize,
            seedNum: this.seedNum,
            noiseConfig: this.noiseConfig,
          };

          const result = await this.pool.enqueue(args);
          const chunk = this._postProcessGeneratedChunk(cx, cy, result);
          this.chunks.set(key, chunk);
          this.generationQueue.delete(key);
          return chunk;
        })();

        this.generationQueue.set(key, generationPromise);
        return await generationPromise;
      } catch (err) {
        console.warn(`[WorldManager] Worker generation failed for chunk ${cx},${cy}:`, err);
        this.generationQueue.delete(key);
      }
    }

    const data = this._generateChunkData(cx, cy);
    const chunk = this._postProcessGeneratedChunk(cx, cy, data);
    this.chunks.set(key, chunk);
    return chunk;
  }

  getChunk(cx, cy) {
    const key = this._key(cx, cy);

    if (this.chunks.has(key)) {
      const chunk = this.chunks.get(key);
      if (chunk.canvas) return chunk;
    }

    const placeholder = this._postProcessGeneratedChunk(cx, cy, null);
    this.chunks.set(key, placeholder);

    this._generateChunkAsync(cx, cy).catch((err) => {
      console.warn(`[WorldManager] Async generation failed for ${cx},${cy}:`, err);
    });

    return placeholder;
  }

  getChunksInRect(rect) {
    const tileTotal = this.chunkSize * this.tileSize;
    const minCx = Math.floor(rect.minX / tileTotal);
    const maxCx = Math.floor(rect.maxX / tileTotal);
    const minCy = Math.floor(rect.minY / tileTotal);
    const maxCy = Math.floor(rect.maxY / tileTotal);

    const chunks = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        chunks.push(this.getChunk(cx, cy));
      }
    }
    return chunks;
  }

  getTileAtWorld(x, y) {
    const tx = Math.floor(x / this.tileSize);
    const ty = Math.floor(y / this.tileSize);
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const chunk = this.getChunk(cx, cy);
    const localX = tx - cx * this.chunkSize;
    const localY = ty - cy * this.chunkSize;

    if (!chunk || !chunk.tiles) return 4;
    if (localX < 0 || localX >= this.chunkSize || localY < 0 || localY >= this.chunkSize) {
      return 4; 
    }
    return chunk.tiles[localY * this.chunkSize + localX] || 4;
  }




  unloadFarChunks(centerCx, centerCy, radius) {
    const toRemove = [];
    for (const [key, chunk] of this.chunks) {
      const dx = Math.abs(chunk.cx - centerCx);
      const dy = Math.abs(chunk.cy - centerCy);

      if (dx > radius || dy > radius) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const chunk = this.chunks.get(key);
      if (chunk && chunk.canvas) {
        chunk.canvas.width = 0;
        chunk.canvas.height = 0;
      }
      this.chunks.delete(key);
      this.collisionMap.delete(key); 
    }
  }

  dispose() {
    for (const chunk of this.chunks.values()) {
      if (chunk.canvas) {
        chunk.canvas.width = 0;
        chunk.canvas.height = 0;
      }
    }
    this.chunks.clear();
    this.generationQueue.clear();

    if (this.pool) {
      this.pool.terminate();
    }
  }

  checkCollision(x, y, radius, ignoreId = null) {
    const chunkX = Math.floor(x / (this.chunkSize * this.tileSize));
    const chunkY = Math.floor(y / (this.chunkSize * this.tileSize));

    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const checkChunkX = chunkX + offsetX;
        const checkChunkY = chunkY + offsetY;
        const chunkKey = this._key(checkChunkX, checkChunkY);

        if (this.collisionMap.has(chunkKey)) {
          const obstacles = this.collisionMap.get(chunkKey);

          for (const obstacle of obstacles) {
            if (ignoreId && obstacle.id === ignoreId) continue;

            const dx = obstacle.x - x;
            const dy = obstacle.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = radius + (obstacle.collisionRadius || obstacle.width * 0.5);

            if (distance < minDistance) {
              return {
                collided: true,
                obstacle,
                penetration: minDistance - distance,
                direction: {
                  x: dx / distance,
                  y: dy / distance,
                },
              };
            }
          }
        }
      }
    }
    return { collided: false };
  }

  _checkTerrainCollision(x, y, radius) {
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);

    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const checkX = tileX + offsetX;
        const checkY = tileY + offsetY;

        const tileType = this.getTileAtWorld(checkX * this.tileSize, checkY * this.tileSize);

        const collisionTiles = [
          5, 
          7,
          8,
          10,
          11, 
        ];

        if (collisionTiles.includes(tileType)) {
          const tileCenterX = checkX * this.tileSize + this.tileSize / 2;
          const tileCenterY = checkY * this.tileSize + this.tileSize / 2;

          const dx = tileCenterX - x;
          const dy = tileCenterY - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = radius + this.tileSize * 0.4; 

          if (distance < minDistance) {
            return {
              collided: true,
              obstacle: {
                type: this._getTileName(tileType),
                tileType: tileType,
                x: tileCenterX,
                y: tileCenterY,
              },
              penetration: minDistance - distance,
              direction: {
                x: dx / distance,
                y: dy / distance,
              },
            };
          }
        }

        if (tileType === 0 || tileType === 1) {
          const tileCenterX = checkX * this.tileSize + this.tileSize / 2;
          const tileCenterY = checkY * this.tileSize + this.tileSize / 2;

          const dx = tileCenterX - x;
          const dy = tileCenterY - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = radius + this.tileSize * 0.3;

          if (distance < minDistance) {
            return {
              collided: true,
              obstacle: {
                type: 'water',
                tileType: tileType,
                x: tileCenterX,
                y: tileCenterY,
              },
              penetration: minDistance - distance,
              direction: {
                x: dx / distance,
                y: dy / distance,
              },
            };
          }
        }
      }
    }

    return { collided: false };
  }

  _getTileName(tileType) {
    const names = {
      0: 'deep_ocean',
      1: 'ocean',
      2: 'shallow_water',
      3: 'beach',
      4: 'grass',
      5: 'forest',
      6: 'dirt',
      7: 'mountain',
      8: 'snow_mountain',
      9: 'road',
      10: 'building',
      11: 'ruin',
    };
    return names[tileType] || 'unknown';
  }

  logTerrainInfo(cx, cy) {
    const chunk = this.getChunk(cx, cy);
    if (!chunk || !chunk.tiles) return;

    const tileCounts = {};
    for (let i = 0; i < chunk.tiles.length; i++) {
      const tileType = chunk.tiles[i];
      tileCounts[tileType] = (tileCounts[tileType] || 0) + 1;
    }

    console.log(`🌍 Chunk (${cx},${cy}) Terrain Composition:`, tileCounts);
  }

  getPlayerTileInfo(x, y) {
    const tileType = this.getTileAtWorld(x, y);
    const tileName = this._getTileName(tileType);

    const tileInfo = `Player at (${x.toFixed(1)}, ${y.toFixed(
      1
    )}) standing on: ${tileName} (type: ${tileType})`;
    console.log(tileInfo);

    return {
      tileType: tileType,
      tileName: tileName,
      isCollidable: [0, 1, 5, 7, 8, 10, 11].includes(tileType),
    };
  }

  getNearbyObstacles(x, y, radius) {
    const nearby = [];
    for (const [chunkKey, obstacles] of this.collisionMap) {
      for (const obstacle of obstacles) {
        const dx = obstacle.x - x;
        const dy = obstacle.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < radius) {
          nearby.push({
            ...obstacle,
            distance: distance,
          });
        }
      }
    }
    return nearby;
  }

  clearChunk(cx, cy) {
    const key = this._key(cx, cy);
    console.log(`Clearing chunk ${cx},${cy} (key: ${key})`);

    if (this.chunks.has(key)) {
      const chunk = this.chunks.get(key);
      if (chunk && chunk.canvas) {
        chunk.canvas.width = 0;
        chunk.canvas.height = 0;
      }
      this.chunks.delete(key);
      console.log(`Removed chunk ${cx},${cy} from cache`);
    }

    if (this.generationQueue.has(key)) {
      this.generationQueue.delete(key);
      console.log(`Removed chunk ${cx},${cy} from generation queue`);
    }

    if (this.collisionMap.has(key)) {
      this.collisionMap.delete(key);
      console.log(`Removed collision data for chunk ${cx},${cy}`);
    }

    return true;
  }
}
