// Точка входа потока: подключить tsx и загрузить worker.ts (свой TypeScript-загрузчик Node
// понимает не весь синтаксис, а флаг --import tsx потоку под node --test не передаётся).
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
