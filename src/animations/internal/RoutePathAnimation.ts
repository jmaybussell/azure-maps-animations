import * as azmaps from "azure-maps-control";
import { MapPathPlayableAnaimation as MapPathPlayableAnimation } from './MapPathPlayableAnimation';
import { RoutePathAnimationOptions } from '../options/RoutePathAnimationOptions';
import { Utils } from '../../helpers/Utils';
import { TimeSpan } from '../interfaces/TimeSpan';
import { PointPairValueInterpolation } from '../interfaces/PointPairValueInterpolation';

/** Event arguments for a RoutePathAnimation state. */
export interface RoutePathAnimationEvent {
    /** The current position on the path. */
    position?: azmaps.data.Position;

    /** The current heading on the path. */
    heading?: number;
    
    /** Average speed between points in meters per second. */
    speed?: number;

    /** Estimated timestamp in the animation based on the timestamp information provided for each point.  */
    timestamp?: number;
}

/** Animates a map and/or a Point shape along a route path. The movement will vary based on timestamps within the point feature properties. */
export class RoutePathAnimation extends MapPathPlayableAnimation {

    /**************************
    * Private Properties
    ***************************/
   
    private _shape: azmaps.Shape | azmaps.HtmlMarker;
    private _route: azmaps.data.Feature<azmaps.data.Point, any>[];

    /** Total time in ms. */
    private _totalTime: number;

    private _positions: azmaps.data.Position[];

    /** Time stamps as numbers for faster calculations. */
    private _timestamps: number[];

    /** Heading between each point. */
    private _headingIntervals: number[];    
    
    /** Average speed between positions. */
    private _speedIntervals: number[];

    /** Interval time between positions. */
    private _timeIntervals: number[];

    /** Interpolations to perform on custom data. */
    private _valueInterpolations: PointPairValueInterpolation[];

    /**************************
    * Constructor
    ***************************/

    constructor(route: azmaps.data.Feature<azmaps.data.Point, any>[], shape?: azmaps.Shape | azmaps.HtmlMarker, options?: RoutePathAnimationOptions) {
        super();

        this._shape = shape;
        this._route = route;

        this.setOptions(Object.assign({
            rotate: true,
            rotationOffset: 0
        },  options || {}));

        if (options && options.autoPlay) {
            this.play();
        } 
    }

    /**************************
    * Public Methods
    ***************************/

    /** Disposes the animation. */
    public dispose(): void {
        this._route = null;
        this._headingIntervals = null;
        this._positions = null;
        this._timestamps = null;
        this._timeIntervals = null;
        this._totalTime = null;
        this._shape = null;

        super.dispose();
    }

    /** Gets the duration of the animation. Returns Infinity if the animations loops forever. */
    public getDuration(): number {
        if(typeof this._totalTime !== 'undefined'){
            return this._totalTime / this._pathOptions.speedMultiplier;
        }

        return super.getDuration();
    }

    /** Gets the animation options. */
    public getOptions(): RoutePathAnimationOptions {
        return Object.assign({}, <RoutePathAnimation>super.getOptions(), { 
            valueInterpolations: this._valueInterpolations
         });
    }

    /** Sets the options of the animation. */
    public setOptions(options: RoutePathAnimationOptions): void {
        if(options){
            if(options.valueInterpolations && Array.isArray(options.valueInterpolations)){
                this._positions = null;
                this._valueInterpolations = options.valueInterpolations;
            }

            super.setOptions(options);

            let isPlaying = this.isPlaying();

            if(isPlaying){
                this.pause();
            }

            if(!this._positions){
                this._processPath();

                if (this._pathOptions.captureMetadata) {
                    if(this._headingIntervals.length > 0){
                        Utils.setMetadata(this._shape, {
                            heading: this._headingIntervals[0],
                            speed: this._speedIntervals[0], 
                            timestamp:this._timestamps[0]
                        });
                    }
                }
            }

            if(isPlaying){
                this.play();
            }
        }
    }

    /** Gets the time span of the animation. */
    public getTimeSpan(): TimeSpan {
        if(this._timestamps.length > 0){
            return {
                begin: this._timestamps[0],
                end: this._timestamps[this._timestamps.length - 1]
            };
        }

        return null;
    }

    /** Gets the positions that form the route path. */
    public getPath(): azmaps.data.Position[] {
        return JSON.parse(JSON.stringify(this._positions));
    }

    /** 
     * Callback function that contains the animation frame logic.  
     * @param progress The progress of the animation where 0 is start and 1 is the end.
     */
    public onAnimationProgress(progress: number): RoutePathAnimationEvent {
        if(this._positions && this._positions.length > 1){
            let state: RoutePathAnimationEvent = {};
            let idx = 0;
            let props: any;
            let offset = 0;
            let shape = this._shape;

            const pathOptions = this._pathOptions;
            const sourcePos = this._positions;
            const headings = this._headingIntervals;
            const speeds = this._speedIntervals;
            const timestamps= this._timestamps;
            const route = this._route;

            if (progress === 1) {
                //Animation is done.
                idx = headings.length - 1;
                state = {
                    position: sourcePos[idx + 1],
                    heading: headings[idx],
                    speed: speeds[idx],
                    timestamp: timestamps[idx + 1]
                };
               
                if (pathOptions.map) {
                    this._setMapCamera(state.position, state.heading, false);
                } 

                Utils.setCoordinates(shape, state.position, sourcePos);

                props = route[idx].properties;
                offset = 1;
            } else if (progress === 0) {
                idx = 0;
                state = {
                    position: sourcePos[0],
                    heading: headings[0],
                    speed: speeds[0],
                    timestamp: timestamps[0]
                };

                if (pathOptions.map) {
                    this._setMapCamera(state.position, state.heading, false);
                } 

                Utils.setCoordinates(shape, state.position, [state.position, state.position]);

                props = route[0].properties;
            } else {
                var dt = this._totalTime * progress;
                var positions: azmaps.data.Position[] = null;

                //Calculate the coordinate part way between the origin and destination.
                if (dt > this._totalTime) {
                    idx = headings.length - 1;
                    state = {
                        heading: headings[idx],
                        speed: speeds[idx],
                        timestamp: timestamps[idx + 1]
                    };
                    positions = sourcePos.slice(0);
                    props = route[idx + 1].properties;
                    offset = 1;
                } else if (dt < 0) {
                    state.heading = headings[0];
                    positions = sourcePos.slice(0, 1);
                } else {
                    var ellapsed = 0;
                    let ti = this._timeIntervals;

                    for (idx = 0; idx <headings.length; idx++) {
                        if (ellapsed + ti[idx] >= dt) {
                            state.heading = headings[idx];
                            state.speed = speeds[idx];
                            positions = sourcePos.slice(0, idx + 1);

                            //Time in ms remaining that forms sub-path.
                            var dt2 = dt - ellapsed;

                            //Distance travelled based on average speed. Note that dt2 is in ms and speed is in m/s, thus the conversion to seconds.
                            var dx = speeds[idx] * dt2 * 0.001;

                            //Get the offset distance from the last known point.
                            offset = dx / azmaps.math.getDistanceTo(sourcePos[idx], sourcePos[idx + 1]);

                            state.timestamp = timestamps[idx] + dt2;

                            positions.push(azmaps.math.getDestination(sourcePos[idx], state.heading, dx));
                            break;
                        } else {
                            ellapsed += ti[idx];
                        }
                    }
                }

                if (positions && positions.length > 0) {
                    state.position = positions[positions.length - 1];

                    if (pathOptions.map) {
                        //Animate to the next view.
                        this._setMapCamera(state.position, state.heading, positions.length > 2);
                    } 

                    Utils.setCoordinates(shape, state.position, positions);
                }
            }

            state = Object.assign(props || {}, state);

            if (pathOptions.captureMetadata){
                var obj = {};
                let vi = this._valueInterpolations;

                if(vi && Array.isArray(vi)){
                    vi.forEach(vi => {
                        Utils.interpolateValue(route[idx], route[idx + 1], offset, vi, obj);
                    });
                }

                Utils.setMetadata(shape, Object.assign(state, obj));
            }

            return state;
        }

        return null;
    }

    /**************************
    * Private Methods
    ***************************/

    private _processPath(): void {
        if(this._route){

            this._totalTime = 0;
            this._positions = null;

            let positions = [];
            let headingIntervals = [];
            let speedIntervals = [];
            let timeIntervals = [];
            let timestamps = [];


            let r = this._route;
            let f = r[0];

            if (f.type === 'Feature' && f.geometry.type === 'Point' && typeof f.properties._timestamp === 'number') {
                timestamps.push(f.properties._timestamp);
                positions.push(f.geometry.coordinates);

                for (var i = 1, len = r.length; i < len; i++) {
                    f = r[i];

                    if (f.type === 'Feature' && f.geometry.type === 'Point' && typeof f.properties._timestamp === 'number') {
                        positions.push(f.geometry.coordinates);

                        var d = azmaps.math.getDistanceTo(positions[i - 1], positions[i]);

                        timestamps.push(f.properties._timestamp);

                        var dt = timestamps[i] - timestamps[i - 1];
                        timeIntervals.push(dt);
                        this._totalTime += dt;

                        //Get speed in meters per second. Convert time from ms to seconds.
                        speedIntervals.push(d/(dt * 0.001));

                        var h = azmaps.math.getHeading(positions[i - 1], positions[i]);
                        headingIntervals.push(h);
                    }
                }
            } else {
                throw 'Feature is not a point or is missing a _timestamp value.';
            }

            if(r.length !== positions.length){
                this.dispose();
                throw 'Unable to process all points in route.';
            }
            
            this._headingIntervals = headingIntervals;
            this._speedIntervals = speedIntervals;
            this._timeIntervals = timeIntervals;
            this._timestamps = timestamps;
            this._positions = positions;

            super.setOptions({ duration: this._totalTime });
        }
    }
}