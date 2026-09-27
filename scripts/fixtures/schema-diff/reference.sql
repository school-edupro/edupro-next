-- MySQL dump 10.13  Distrib 8.0.36
-- Host: localhost    Database: school_alpha
CREATE TABLE `class_master` (
  `ClassId` int(11) NOT NULL AUTO_INCREMENT,
  `ClassName` varchar(50) NOT NULL,
  `FinancialYear` varchar(10) NOT NULL DEFAULT '2024-25',
  `Status` tinyint(1) NOT NULL DEFAULT '1',
  `isTrash` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`ClassId`),
  KEY `idx_year` (`FinancialYear`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
CREATE TABLE `fee_receipt` (
  `ReceiptId` int(11) NOT NULL AUTO_INCREMENT,
  `Amount` decimal(10,2) NOT NULL,
  `PaidOn` datetime DEFAULT NULL,
  PRIMARY KEY (`ReceiptId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `library_langugage_master` (
  `Id` int(11) NOT NULL,
  PRIMARY KEY (`Id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;
INSERT INTO `library_langugage_master` VALUES (1),(2),(3);
-- Dump completed on 2026-09-20 10:00:00
