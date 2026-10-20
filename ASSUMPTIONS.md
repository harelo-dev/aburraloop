# Supuestos del modelo

AburráLoop es una simulación con **datos sintéticos**. Nada aquí viene de una operación real. Cada número de abajo es un supuesto editable en `src/sim/simulate.ts`; los que están en la interfaz se mueven con sliders.

## Qué se simula

Un día de despachos de última milla con pago contra entrega (COD) en los 10 municipios del Valle de Aburrá.

1. Se calcula cuántos paquetes fallan: `despachos × tasa de novedad`.
2. Cada paquete fallido se ubica en un municipio según su peso comercial, con dispersión gaussiana alrededor de su centro (σ entre 1,5 y 3,5 km), y se ajusta a la celda de ~1 km más cercana de la matriz de viaje.
3. Cada fallo recibe una hora (08:00–16:30), un valor COD ($85k–$150k) y un grado de potencial de triaje.
4. Una mini-van intercepta un paquete si el **tiempo por carretera** desde su ubicación es menor o igual al máximo configurado, el grado es A o B y la van no superó su capacidad del día. Si varias vans alcanzan el paquete, va la más cercana que aún tenga capacidad. Los paquetes se atienden en orden de hora.
5. Un paquete entregado a la van se salva con cierta probabilidad, que baja si llega tarde (ver más abajo). Si no se salva, vuelve al CEDI igual.

## Parámetros

| Supuesto | Valor | Dónde |
| --- | --- | --- |
| Peso de envíos | Medellín 48%, Norte 24%, Sur 28% | `src/data/places.json` |
| Mezcla de fallos | 45% Grado A, 25% Grado B, 30% Grado C (sliders) | UI |
| Éxito 2.º intento, Grado A | 60% (slider 30–90%) | UI |
| Éxito liquidación flash, Grado B | 80% | `ASSUMPTIONS.gradeBSuccess` |
| Hora límite del reintento | éxito pleno hasta las 12:00, nulo desde las 17:00, lineal en medio | `attemptFullUntil`, `attemptNoneFrom` |
| Margen del producto | 28% del COD (A), 12% (B) | `marginA`, `marginB` |
| Parte del margen que se pierde si vuelve al CEDI | 50% (slider 10–100%) | UI |
| Flete ahorrado | $900 por km, ida y vuelta al CEDI, más $4.000 de manejo | `freightCopPerKm`, `handlingCop` |
| Costo de una van | $320.000 por día (slider) | UI |
| Capacidad de una van | 80 paquetes por día | `vanCapacity` |
| Costo del desvío de la moto | $300 por minuto, ida y vuelta hacia la van (slider $0–1.500) | UI |
| Tiempo máximo van → paquete | 25 min (slider 10–45) | UI |

## Modo guiado

Las respuestas se convierten en parámetros del simulador: bodega, despachos y motos, tasa de novedad, mezcla de causas (A, B y el resto como C), éxito del reintento en Grado A, valor promedio del pedido y costo de una van por día. Si das el costo mensual de una moto y sus horas efectivas, el costo por minuto sale de dividir uno entre las otras; si no, se usa $300 por minuto. Todo lo demás son los supuestos de la demo.

El resultado compara 1 a 3 vans con los tres modos de operar y elige el de mayor neto por día. Si ninguno es positivo, lo dice. **El rango** mueve la tasa de novedad en ±2 puntos si la mediste (±5 si es una estimación) y el éxito del reintento en ±5 puntos (±15), y reporta el menor y el mayor de las cuatro combinaciones. Solo cubre esas dos cifras: el resto de supuestos (costos, márgenes, tiempos de viaje) no entra en el rango, y por eso el rango es optimista como medida de incertidumbre.

**El costo de las novedades** es, por cada fallo, el flete de ida y vuelta al CEDI, el manejo y la parte del margen que se pierde si vuelve; se promedia sobre 8 días simulados.

## Resumen del escenario

Convierte cada cifra en una banda (por ejemplo, 600 despachos pasan a «500 a 699» y una tasa de 15% a «14% a 17%») y no tiene ningún campo para filas, direcciones o coordenadas. Con un archivo cargado agrega solo el tamaño en bandas: días de datos y número de fallos. Existe para mostrar la estructura de lo que se podría compartir, y hoy no se envía.

## Cuánto se recupera

Cada paquete salvado suma el flete ahorrado ($900 por km de carretera hasta el CEDI, ida y vuelta, más $4.000 de manejo) y **solo la parte del margen que de verdad se pierde al volver al CEDI**. Un paquete devuelto puede reofrecerse al día siguiente, así que contar el margen completo sobrestimaría el rescate. Con el valor por defecto de 50%, cada rescate suma la mitad del margen.

**La hora importa.** Un paquete que llega a la van a las 9:00 se reintenta con las probabilidades de siempre (60% en Grado A, 80% en Grado B). Uno que llega a las 14:30 tiene la mitad, y uno que llega a las 17:00 ya no tiene reintento posible ese día. Esta regla es igual en los dos modos de operación, para que la comparación sea justa.

El **neto** es lo recuperado, más el ahorro al cierre (solo en recorridos), menos el costo de las vans y menos el costo de los desvíos (solo en intercepción).

## Cómo opera la van

**Intercepta fallos en la calle.** La van está en una celda. Cuando una moto tiene un fallo dentro del alcance, va hasta la van con el paquete y vuelve a su ruta. Ese desvío cuesta $300 por minuto, ida y vuelta (se usa el tiempo de carretera entre el paquete y la van). La entrega a la van es inmediata.

**Recorre a las motos (AM y PM) y es el punto de cierre.** Las motos tienen cada una una zona de trabajo fija, repartidas por municipio según su peso en los envíos. Cada moto pertenece a la van más cercana dentro del alcance. La van visita a cada una de las suyas, la más cercana primero, una vez en la ventana de la mañana (9:00 a 12:00) y otra en la de la tarde (13:00 a 16:00), con 6 minutos por visita. Las motos que no alcanza a visitar antes de que cierre la ventana esperan a la siguiente ronda. Cada fallo se entrega a la van en la primera visita posterior; los que ocurren después de la visita de la tarde se entregan al cierre.

- Los paquetes entregados en una ronda pueden reintentarse ese día, con el éxito que baja según la hora de la visita y hasta la capacidad de la van (80 paquetes). Los entregados al cierre no tienen reintento.
- Al cierre, cada moto que tuvo fallos va a la van y no al CEDI, y se ahorra la diferencia de tiempo, a $300 por minuto. **Es un supuesto fuerte:** supone que sin paquetes fallidos la moto no necesita pasar por el CEDI al cierre.
- La opción "visitar solo a las motos con algo pendiente" quita las visitas vacías y deja tiempo para otras. Por defecto la van visita a todas, como en la propuesta original.
- Las vans de este modo se ubican donde se concentran las motos (concentración, con historial o con conocimiento del día).
- Los fallos de Grado C se entregan a la van pero no se reintentan.

## Dónde van las vans

La ubicación se escoge una vez por día. Se combinan dos decisiones en la interfaz.

**Qué información se usa**

- **Según fallos de días previos (por defecto):** el promedio de **10 días simulados previos**, distintos del día evaluado, como si fuera el historial de la operación.
- **Fijas por zona:** Norte (Bello), Centro (Medellín) y Sur (Itagüí), según cuántas vans haya. Si un ancla queda demasiado cerca del CEDI se descarta, y esa van se ubica donde indica el historial y el criterio elegido.
- **Con conocimiento del día (techo):** los fallos del propio día. No se puede lograr en la práctica y sirve como cota de lo que da una buena ubicación.

**Con qué criterio** (algoritmos voraces: agregan una van a la vez; solo en modo intercepta)

- **Mayor alcance:** cada van va donde cubre, dentro del tiempo máximo, el mayor valor esperado que ninguna otra cubre ya. Tiende a mandar la 2.ª van lejos del núcleo.
- **Mayor valor neto (por defecto):** modela el día con la capacidad de cada van (80 paquetes) y el desvío de la moto, y pone cada van donde sube más el neto total.
- **Concentración de paquetes:** minimiza el tiempo total de carretera hasta los paquetes, contando paquetes y no pesos (p-mediana voraz). Un paquete que ninguna van alcanza cuenta como el doble del alcance máximo, así que el alcance sigue importando.

Una **distancia mínima van → CEDI** (10 minutos por defecto, entre 0 y 20) vale para todas las combinaciones: una van pegada al CEDI no intercepta nada que el CEDI no reciba igual, así que esas celdas quedan fuera. Con CEDI Sur, por ejemplo, la van única va al norte y no al sur.

El valor esperado de un fallo es la probabilidad de que el segundo intento funcione, por la hora de llegada, por lo que recupera. Los fallos son proporcionales a los despachos de cada municipio, así que la concentración de fallos sigue la de las entregas.

## Qué encontramos al comparar

### Dónde poner la 2.ª van (modo intercepta)

Con 2 vans, 6 días simulados y CEDI Centro, probamos **todos los pares posibles** de celdas contra los algoritmos voraces:

| Escenario | Mejor par posible | Mejor par solo en el núcleo | Voraz (valor neto) | Voraz (alcance) |
| --- | --- | --- | --- | --- |
| 600 despachos, 15% | Medellín + Girardota, $40 k | Envigado + Bello, −$7 k | $27 k | −$57 k |
| 900 despachos, 15% | Medellín + Girardota, $437 k | Envigado + Bello, $328 k | $429 k | $309 k |
| 1.200 despachos, 25% | Sabaneta + Copacabana, $1,51 M | Envigado + Bello, $1,44 M | $1,45 M | $1,26 M |

- La mejor 2.ª van **no** se queda en el núcleo denso. La van de Medellín, con 25 minutos de alcance, ya cubre casi todo el núcleo y todavía le sobra capacidad. La segunda rinde más alcanzando el norte (Bello, Copacabana, Girardota y Barbosa suman 24% de los envíos), que de otro modo vuelve entero al CEDI.
- Partir el núcleo en dos cuesta entre $47 mil y $109 mil netos por día en estos escenarios.
- El algoritmo de valor neto queda a $13 mil, $8 mil y $58 mil del mejor par. El de mayor alcance queda entre $97 mil y $245 mil por debajo.
- Cambia con el alcance: con **15 minutos**, la 2.ª van sí va al sur y parte el núcleo (Medellín + Sabaneta con concentración), porque la primera ya no cubre todo.
- Con los parámetros por defecto una sola van rinde más que dos: $231 mil contra $51 mil por día, y tres pierden $176 mil. Con 15% de novedad, la 2.ª van no supera a la 1.ª en todo el rango de 150 a 1.200 despachos.

### Intercepta o recorre

Neto por día y % de fallos salvados, promedio de 8 días, con la ubicación por historial:

| Escenario | Vans | Intercepta | Recorre (todas las motos) | Recorre (solo pendientes) |
| --- | --- | --- | --- | --- |
| 600 despachos, 24 motos | 1 | $231 k · 32% | $149 k · 17% | $236 k · 19% |
|  | 2 | $51 k · 34% | $41 k · 22% | $108 k · 23% |
| 900 despachos, 36 motos | 1 | $477 k · 30% | $143 k · 12% | $202 k · 13% |
|  | 2 | $400 k · 33% | $421 k · 19% | $469 k · 20% |
|  | 3 | $243 k · 35% | $364 k · 24% | $428 k · 25% |
| 1.200 despachos, 45 motos | 2 | $1,42 M · 28% | $1,21 M · 14% | $1,34 M · 16% |
|  | 3 | $1,67 M · 34% | $1,59 M · 21% | $1,65 M · 21% |

- **Con 1 van, intercepta gana:** una sola van no alcanza a visitar a todas las motos en cada ventana.
- **Con 2 o 3 vans y muchas motos, recorre empata o gana**, sobre todo si solo visita a las motos con algo pendiente. Salva menos paquetes, pero no paga desvíos y ahorra el regreso de las motos al CEDI.
- **Depende de cuánto vale un minuto de la moto.** Con 900 despachos, 36 motos y 2 vans:

| Costo por minuto de la moto | Intercepta | Recorre |
| --- | --- | --- |
| $0 | $1,03 M | $366 k |
| $300 | $400 k | $421 k |
| $600 | −$355 k | $476 k |
| $900 | −$593 k | $532 k |

Si el tiempo de las motos es caro, cada desvío a la van destruye valor y recorrer gana con claridad. Si es barato, interceptar gana.

Son resultados de un modelo sintético. Con una distribución real de fallos pueden cambiar.

## Cuando cargas tus datos

El simulador deja de generar fallos sintéticos y los **saca de tu archivo**: cada día simulado toma al azar, con reemplazo, tantos fallos como `despachos × tasa de novedad`, y cada uno conserva su ubicación, su hora, su valor y su grado. Así los controles de volumen y de tasa siguen funcionando. Los fallos que solo se pudieron ubicar por municipio se reparten alrededor de su centro, con la misma dispersión que los sintéticos, y las motos del modo de recorridos se reparten por municipio según tus fallos.

De tu archivo salen estos parámetros, que se aplican a los controles y se pueden corregir a mano: la tasa de novedad (fallos por día entre los despachos que indiques), el éxito del segundo intento en Grado A y en Grado B (solo si hay al menos 15 casos con resultado), y el número de motos (solo si hay columna de mensajero). **Todo lo demás sigue siendo supuesto**: costos, capacidad de la van, margen, costo del desvío y tiempos de viaje.

Límites que conviene tener presentes:

- **Muestra pequeña.** Con pocos días o pocos fallos, las vans se ubican sobre la misma muestra que luego se simula, y el resultado se ve mejor de lo que sería. El panel avisa si hay menos de 100 fallos o menos de 10 días. Un archivo más largo reduce este efecto.
- **Los días no se repiten tal cual.** Se muestrea de todos los fallos, así que no se conserva el orden ni la agrupación por día. Un día excepcionalmente malo se diluye.
- **Ubicación aproximada.** Una dirección ubicada por calle puede quedar a más de un kilómetro de la real, y la malla es de ~1 km. Más de 30% de filas solo por municipio dispara un aviso.
- **Los datos no dicen por qué.** Que una zona o una franja falle más muestra dónde y cuándo ocurre, no la causa. Una franja puede fallar menos por quién pide en ella, no por la hora.
- **Fallos fuera del valle** (más de 3 km de la celda más cercana) se excluyen y se cuentan.
- **Horas faltantes** se completan al azar entre las 8:00 y las 16:30, y la hora decide si un reintento funciona, así que sin hora la calibración es débil.
- **Sesgo de selección.** El archivo solo trae los fallos que se registraron. Si los fallos más difíciles no se registran, el éxito del reintento sale sobrestimado.

### Cómo se decide dónde está cada fila

1. Si la fila trae **coordenadas** válidas (en dos columnas o en una), se usan tal cual. Un par invertido (longitud en la columna de latitud) se corrige.
2. Si no, y trae **dirección escrita**, se busca en Nominatim, pero **solo si diste permiso**. Sin permiso no sale ninguna dirección del navegador.
3. Si no se encontró, o no hubo permiso, y la fila trae **municipio**, se ubica en el centro del municipio y se reparte alrededor con la misma dispersión de los datos sintéticos.
4. Si no hay nada de eso, la fila queda fuera y se cuenta.

Una columna con un nombre ambiguo, como «Ubicación», se clasifica mirando los valores: si al menos 60% de las primeras 50 filas son coordenadas, se trata como coordenadas; si no, como direcciones. Una dirección que en realidad trae coordenadas dentro se reconoce y no se busca.

### Tasa de novedad por zona, hora y día

Solo existe si el archivo dice qué filas fueron entregadas y cuáles fallidas.

- **Tasa por grupo:** fallos entre entregas totales (exitosas y fallidas) de ese municipio, franja de hora o día de la semana.
- **Ajuste por poca evidencia:** la tasa de un grupo se mezcla con la tasa general como si la general valiera por 20 entregas (`PRIOR_STRENGTH`). Un grupo de 8 entregas con 3 fallos queda cerca de la general. A cada celda de ~1 km se le aplica lo mismo, mezclándola con la tasa ajustada de su municipio y con peso de 15 entregas.
- **Intervalo:** Wilson al 90%. Un grupo se marca como «más alto» o «más bajo de lo normal» solo si todo su intervalo queda por encima o por debajo de la tasa general.
- **Exceso:** fallos reales menos los que daría la tasa general sobre sus entregas.
- **Por zona del mapa:** solo si al menos 90% de las filas traen coordenadas. Con direcciones solo se buscan los fallos (las entregas serían demasiadas para un servicio que atiende una consulta por segundo), así que las tasas quedan por municipio.
- **Filas sin estado reconocible** (ni entregado ni fallido) se excluyen y se cuentan.

**Ubicar las vans por tendencia.** Ordena las celdas por entregas × tasa ajustada, reparte entre ellas los fallos esperados de un día y aplica el mismo criterio de ubicación que con el historial. Cuando hay muchos días de datos coincide casi del todo con ubicar por el historial de fallos, porque el conteo ya refleja la tasa. Aporta más con pocos días, donde el conteo crudo es ruidoso. Su principal uso está en otra parte: saber en qué zonas y horas intervenir para reducir novedades.

## Palancas para reducir novedades

**Qué vale evitar una novedad.** Por cada fallo: flete de ida y vuelta al CEDI, manejo y la parte del margen que se pierde si vuelve, promediado por grado (A, B o C) sobre 8 días simulados. La comparación parte de una operación **sin van**: si ya hay una, parte de esas novedades ya se rescata y evitarlas vale menos.

**Efecto necesario.** Para cada palanca: costo al día entre lo que ahorraría si evitara todas las novedades que ataca. Es la fracción de esas novedades que tiene que evitar para cubrir su costo. Por encima de 100% no se paga nunca. Se clasifica en pequeño (menos de 10%), mediano (menos de 30%), grande y «no se paga ni evitando todos».

| Palanca | Ataca | Costo al día |
| --- | --- | --- |
| Confirmar antes de salir | Fallos A | costo por paquete × despachos |
| Entregar en otra franja | Fallos desde las 14:00 | costo por paquete movido × paquetes de esas horas |
| Reintento el mismo día | Fallos A | minutos de moto por reintento × costo del minuto × fallos A |
| Recoger en la van o en un punto | Fallos A | el costo de una van al día |
| Pago anticipado | Fallos B | costo por paquete ofrecido × despachos |

Los costos por defecto ($200, $150, 15 minutos y $100) **son ejemplos**, no cotizaciones.

**Tamaño de un piloto.** Para dos grupos, la fórmula de dos proporciones con 5% de significancia y 80% de potencia, comparando la tasa de fallos que ataca la palanca con esa misma tasa reducida por el efecto. Los días salen de repartir los paquetes expuestos en dos grupos. Para las palancas que actúan después del fallo (reintento, recoger en la van) lo que se mide es cuántos clientes aceptan: con unos 96 fallos ofrecidos se estima ese porcentaje con ±10 puntos. Un piloto de más de 60 días se marca como demasiado largo.

**Lo que no sabe.** Los efectos de varias palancas se solapan y no se suman sin más. Un piloto solo mide el efecto si el reparto entre grupos es al azar.

## Análisis de la interfaz

Las cuatro tarjetas de análisis promedian **8 días simulados** (semillas consecutivas) con los parámetros actuales. Si eliges 0 vans, usan 2.

- **Cuántas vans:** neto por día con 0 a 3 vans, en el modo elegido.
- **Punto de equilibrio:** neto por día según despachos diarios (150 a 1.200) para 1, 2 y 3 vans, con la tasa de novedad actual. Los cruces se interpolan linealmente entre puntos de 50 despachos.
- **Dónde poner las vans:** zonas fijas, historial con cada criterio y el techo con conocimiento del día, lado a lado. En recorridos hay un solo criterio (concentración de motos).
- **¿Intercepta o recorre?:** los dos modos con 1, 2 y 3 vans, incluida la variante que solo visita a las motos con algo pendiente.
- **Sensibilidad:** cada supuesto se mueve hacia abajo y hacia arriba con todo lo demás fijo. Rangos: éxito del 2.º intento ±20 puntos, tasa de novedad ±5 puntos, tiempo máximo ±10 min, proporción de Grado A 35% a 55% (Grado C compensa), éxito de Grado B 65% a 95%, margen de Grado A 20% a 36%, parte del margen que se pierde ±25 puntos, costo del desvío $150 a $450 por minuto, costo de van ±25%, flete ±33%, capacidad de la van 40 a 120 paquetes y valor COD ±20%.

Los rangos son un juicio razonable, no intervalos medidos. Con datos reales se reemplazan por los observados.

## Matriz de tiempos de viaje

Dos archivos, generados una sola vez con el servidor demo público de OSRM (perfil de carro). La app no llama a ningún servicio de rutas en vivo.

- `src/data/travel.json`: para una malla de ~1 km sobre el valle (443 celdas), el tiempo y la distancia por carretera desde los puntos de referencia de las zonas y desde cada CEDI. Se genera con `npm run build:matrix`. La distancia al CEDI alimenta el flete ahorrado.
- `src/data/cell-minutes.json`: minutos por carretera entre **cada par de celdas** (443 × 443), redondeados al minuto. Se genera con `npm run build:cellmatrix` y es lo que permite poner una van en cualquier celda. Los 138 pares sin ruta se tratan como inalcanzables. Los tiempos no son simétricos porque hay calles de un solo sentido.

Limitaciones: es tiempo de carro sin tráfico por hora del día, y las motos suelen ser más rápidas en trancón. Las líneas rojas del mapa son rectas y solo ilustran el viaje de retorno; el flete ahorrado sí usa la distancia por carretera.

## Lo que el modelo no hace todavía

- En intercepción, las vans se ubican una vez por día y no se mueven mientras trabajan.
- La ubicación se calcula suponiendo que cada van atiende primero los paquetes más valiosos, pero en la simulación se atiende por orden de hora, que es lo que haría una operación real. Con la capacidad llena, eso puede hacer que más alcance rinda menos.
- En intercepción, el tiempo de viaje hasta la van solo cuesta el desvío de la moto; aparte del reloj del día, no cambia las probabilidades de éxito.
- En recorridos, la ruta de la van es una heurística (la moto más cercana primero), no una ruta óptima, y la posición de cada moto es el centro de su zona, no su ubicación real durante el día.
- El ahorro al cierre supone que la moto, sin paquetes fallidos, no pasa por el CEDI.
- No hay variación de tráfico por hora.
- Los grados A, B y C son una proporción fija, no una clasificación de paquetes reales.
- Los costos son estimaciones redondas, no cotizaciones.

## Cómo calibrarlo con datos reales

Con 30 días de intentos fallidos de una operación (hora, dirección, motivo, valor y desenlace del reintento) se reemplazan la mezcla de grados, la tasa de éxito del segundo intento y la distribución espacial. La estructura del código ya separa esos supuestos del motor.
