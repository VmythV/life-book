import { registerRootComponent } from 'expo';

import './src/background/synthetic-notification-task';
import { AndroidCapabilitySpikeApp } from './src/android-capability-spike-app';

registerRootComponent(AndroidCapabilitySpikeApp);
