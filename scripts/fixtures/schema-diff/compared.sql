-- MySQL dump 10.13  Distrib 8.0.36
-- Host: localhost    Database: school_beta
CREATE TABLE `class_master` (
  `ClassId` int(11) NOT NULL AUTO_INCREMENT,
  `ClassName` varchar(100) NOT NULL,
  `FinancialYear` varchar(10) NOT NULL DEFAULT '2024-25',
  `Status` varchar(10) NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`ClassId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE `fee_receipt` (
  `ReceiptId` int(11) NOT NULL AUTO_INCREMENT,
  `Amount` decimal(10,2) NOT NULL,
  `PaidOn` datetime DEFAULT NULL,
  PRIMARY KEY (`ReceiptId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `transport_route_extra` (
  `Id` int(11) NOT NULL,
  `RouteName` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`Id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Dump completed on 2026-09-21 09:30:00
