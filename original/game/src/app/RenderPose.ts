import * as THREE from 'three';

export interface PoseSource {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly poseRevision: number;
}

export interface SampledPose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/**
 * The persistent bridge between fixed physics states and display frames.
 *
 * Physics owns the two completed states. Rendering only moves between them, so a display frame
 * with no physics step still advances instead of holding and then jumping on the next step.
 */
export class RenderPose {
  private readonly previousPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly previousQuaternion = new THREE.Quaternion();
  private readonly currentQuaternion = new THREE.Quaternion();
  private readonly renderedPosition = new THREE.Vector3();
  private readonly renderedQuaternion = new THREE.Quaternion();
  private revision = -1;

  constructor(source: PoseSource) {
    this.snap(source);
  }

  /** Record one newly completed fixed step. Call exactly once after each physics world step. */
  advance(source: PoseSource): void {
    if (source.poseRevision !== this.revision) {
      this.snap(source);
      return;
    }
    this.previousPosition.copy(this.currentPosition);
    this.previousQuaternion.copy(this.currentQuaternion);
    this.currentPosition.copy(source.position);
    this.currentQuaternion.copy(source.quaternion);
  }

  /** Sample every display frame, including frames that completed no physics step. */
  sample(source: PoseSource, alpha: number): SampledPose {
    if (source.poseRevision !== this.revision) this.snap(source);
    const t = THREE.MathUtils.clamp(alpha, 0, 1);
    this.renderedPosition.copy(this.previousPosition).lerp(this.currentPosition, t);
    this.renderedQuaternion.copy(this.previousQuaternion).slerp(this.currentQuaternion, t);
    return { position: this.renderedPosition, quaternion: this.renderedQuaternion };
  }

  /** Collapse both ends after a teleport, so no frame can draw the path across it. */
  snap(source: PoseSource): void {
    const position = source.position;
    const quaternion = source.quaternion;
    this.previousPosition.copy(position);
    this.currentPosition.copy(position);
    this.previousQuaternion.copy(quaternion);
    this.currentQuaternion.copy(quaternion);
    this.revision = source.poseRevision;
  }
}
