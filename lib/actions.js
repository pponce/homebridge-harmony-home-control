import { validateAction, safeMessage } from './config.js';
import { numeric, quantize, validateValue } from './hap.js';

export class Actions {
  constructor(access, report = () => {}) { this.access = access; this.report = report; this.queues = new Map(); this.pending = 0; }
  serial(serviceId, job) {
    if (this.pending >= 32) return Promise.reject(new Error('Too many commands are pending. Try again shortly.'));
    this.pending++;
    const previous = this.queues.get(serviceId) || Promise.resolve();
    const task = previous.catch(() => {}).then(job);
    this.queues.set(serviceId, task);
    return task.finally(() => { this.pending--; if (this.queues.get(serviceId) === task) this.queues.delete(serviceId); });
  }
  async execute(action, label = 'Accessory command', source = 'test') {
    validateAction(action);
    return this.serial(action.serviceId, async () => {
      try {
        const { characteristic: c } = this.access.resolve(action.serviceId, action.characteristic);
        let value = action.value;
        if (action.operation !== 'set') {
          const current = await this.access.read(action.serviceId, action.characteristic);
          if (action.operation === 'toggle') {
            if (c.format === 'bool') value = !current;
            else if (numeric(c) && (c.validValues?.length === 2 && c.validValues.includes(0) && c.validValues.includes(1) || c.minValue === 0 && c.maxValue === 1)) value = current ? 0 : 1;
            else throw new Error('Toggle is only available for on/off controls.');
          } else {
            if (!numeric(c) || typeof current !== 'number') throw new Error('Adjustments require a readable numeric control.');
            value = quantize(current + (action.operation === 'increase' ? action.value : -action.value), c);
          }
        }
        validateValue(c, value);
        const result = await this.access.write(action.serviceId, action.characteristic, value);
        this.report({ source, name: label, ok: true });
        return result;
      } catch (error) { this.report({ source, name: label, ok: false, message: safeMessage(error) }); throw error; }
    });
  }
}
