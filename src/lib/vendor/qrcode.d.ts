/** 生成二维码模块矩阵（true 为黑色模块） */
declare function qrMatrix(text: string, level?: 'L' | 'M' | 'Q' | 'H'): boolean[][];
export default qrMatrix;
