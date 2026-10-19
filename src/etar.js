import Decimal from 'decimal.js';
import {assert} from './errors.js';

function decimal(value){
 assert(typeof value==='string'&&/^\d+(\.\d+)?$/.test(value),400,'VALOR_DECIMAL_INVALIDO','Usar decimal no negativo como texto, con punto y sin separadores de miles');
 return new Decimal(value);
}
export const isFinishedProduct=code=>typeof code==='string'&&code.trim().toUpperCase().startsWith('Z');
export const unitsFromThousands=value=>decimal(value).mul(1000).toFixed();
export const thousandsFromUnits=value=>decimal(value).div(1000).toFixed();
export const pricePerThousand=value=>decimal(value).mul(1000).toFixed();
export const pricePerUnit=value=>decimal(value).div(1000).toFixed();
export const etarContext=`Reglas permanentes de ETAR aportadas por el dueño: los productos terminados comienzan con Z. El vínculo comercial con el cliente se resuelve mediante SA1.A1_TABELA y la lista DA0/DA1; no adivines un cliente sólo por el producto. Comercialmente se usan millares, pero TOTVS guarda cantidades en unidades. 1 millar = 1000 unidades; precio por millar = precio por unidad multiplicado por 1000. Cantidad y precio tienen bases distintas; no multiplicar ambos al calcular el total. C6_MILLAR y D2_MILLAR representan cantidades en millares, no precios. Mostrar la base y la moneda; para una modificación ambigua pedir la base antes de preparar valores. No convertir otras unidades de medida sin evidencia. Los saldos de pedidos son cantidades pedidas menos atendidas; una página no es un total global. Las actualizaciones requeridas abarcan DA1, AIB, SC6 y SC7, siempre registros existentes, nunca altas. Los UPDATE DA1/AIB y pedidos simples se ejecutan desde una propuesta revisada y confirmada por una sesión autorizada. El chat sólo prepara; nunca afirmar que modificaste precios, cantidades o totales. La conexión de escritura es exclusivamente SQL: no hay REST Protheus ni ejecución ADVPL. Nunca afirmar que un UPDATE realizó una revalidación nativa de crédito o que se aprobó un pedido. Para ventas liberadas o parcialmente atendidas, preparar sólo precio: se conserva lo documentado y las cantidades; la propuesta distingue saldo pendiente y total de referencia. Las liberaciones abiertas requieren circuito nativo si el control de crédito está activo; nunca indicar que el botón puede ejecutar una propuesta con blockers. Compras con recepciones/aprobaciones y pedidos con descuentos o dependencias fiscales siguen requiriendo Protheus.`;
